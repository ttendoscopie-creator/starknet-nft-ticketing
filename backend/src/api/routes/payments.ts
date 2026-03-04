import { FastifyInstance } from "fastify";
import { z } from "zod";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { Queue } from "bullmq";
import { bullmqConnection } from "../../db/redis";
import { authMiddleware } from "../middleware/auth";
import { verifyERC20Transfer } from "../../services/starknet.service";
import { paymentRateLimit } from "../middleware/rateLimit";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const mintQueue = new Queue("mint", {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
  },
});

const TOKEN_ADDRESSES: Record<string, string> = {
  STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  USDC: "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080",
  USDT: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",
};

const VerifyCryptoPaymentSchema = z.object({
  eventId: z.string().uuid(),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid Starknet tx hash"),
  buyerWalletAddress: z.string().regex(/^0x[0-9a-fA-F]{63,64}$/, "Invalid Starknet address"),
  currency: z.enum(["STRK", "USDC", "USDT"]),
});

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", authMiddleware);

  app.post("/v1/payments/verify-crypto", { ...paymentRateLimit }, async (request, reply) => {
    const parseResult = VerifyCryptoPaymentSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: "Invalid input", details: parseResult.error.issues });
    }

    const { eventId, txHash, buyerWalletAddress, currency } = parseResult.data;

    // Verify event exists and accepts this currency
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { organizer: true },
    });
    if (!event) {
      return reply.code(404).send({ error: "Event not found" });
    }

    if (!event.acceptedCurrencies.includes(currency)) {
      return reply.code(400).send({ error: `Event does not accept ${currency}` });
    }

    // SECURITY FIX (CRIT-06): Payment goes to organizer treasury, not contract address
    const paymentRecipient = event.organizer.treasuryAddress;

    // Verify the on-chain transfer with sender validation
    const tokenAddress = TOKEN_ADDRESSES[currency];
    const verified = await verifyERC20Transfer(
      txHash,
      paymentRecipient,
      BigInt(event.primaryPrice),
      tokenAddress,
      buyerWalletAddress, // SECURITY FIX (HIGH-14): Validate sender matches buyer
    );

    if (!verified) {
      return reply.code(400).send({ error: "Transaction verification failed" });
    }

    // SECURITY FIX (HIGH-11): Catch unique constraint to handle TOCTOU race
    let pendingMint;
    try {
      pendingMint = await prisma.pendingMint.create({
        data: {
          eventId,
          buyerEmail: request.user!.userId,
          buyerWalletAddress,
          cryptoTxHash: txHash,
          paymentAmount: event.primaryPrice,
          paymentCurrency: currency,
          status: "PENDING",
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Transaction already used for a previous payment" });
      }
      throw err;
    }

    // Queue mint job
    await mintQueue.add("mint", {
      pendingMintId: pendingMint.id,
      eventId,
      buyerEmail: request.user!.userId,
      buyerWalletAddress,
    });

    return reply.code(201).send({
      id: pendingMint.id,
      status: pendingMint.status,
      cryptoTxHash: txHash,
      currency,
    });
  });

  const CreateCheckoutSessionSchema = z.object({
    eventId: z.string().uuid(),
    buyerWalletAddress: z.string().optional(),
  });

  app.post("/v1/payments/create-checkout-session", { ...paymentRateLimit }, async (request, reply) => {
    const parseResult = CreateCheckoutSessionSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({ error: "Invalid input", details: parseResult.error.issues });
    }

    const { eventId, buyerWalletAddress } = parseResult.data;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { _count: { select: { tickets: true } } },
    });
    if (!event) {
      return reply.code(404).send({ error: "Event not found" });
    }

    const remaining = event.maxSupply - event._count.tickets;
    if (remaining <= 0) {
      return reply.code(400).send({ error: "Event is sold out" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: { name: event.name },
            unit_amount: event.primaryPrice,
          },
          quantity: 1,
        },
      ],
      metadata: {
        event_id: eventId,
        buyer_email: request.user!.userId,
        buyer_wallet_address: buyerWalletAddress ?? "",
      },
      success_url: `${FRONTEND_URL}/checkout/${eventId}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/checkout/${eventId}?canceled=true`,
    });

    return reply.code(201).send({ url: session.url });
  });
}
