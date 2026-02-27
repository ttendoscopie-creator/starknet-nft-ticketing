import { FastifyInstance } from "fastify";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, JWTPayload } from "../middleware/auth";
import { verifyERC20Transfer } from "../../services/starknet.service";
import { paymentRateLimit } from "../middleware/rateLimit";

const prisma = new PrismaClient();

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

    const user = (request as unknown as { user: JWTPayload }).user;
    const { eventId, txHash, buyerWalletAddress, currency } = parseResult.data;

    // Verify event exists and accepts this currency
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      return reply.code(404).send({ error: "Event not found" });
    }

    if (!event.acceptedCurrencies.includes(currency)) {
      return reply.code(400).send({ error: `Event does not accept ${currency}` });
    }

    // Prevent tx hash replay
    const existingMint = await prisma.pendingMint.findFirst({
      where: { cryptoTxHash: txHash },
    });
    if (existingMint) {
      return reply.code(409).send({ error: "Transaction already used for a previous payment" });
    }

    // Verify the on-chain transfer
    const tokenAddress = TOKEN_ADDRESSES[currency];
    const verified = await verifyERC20Transfer(
      txHash,
      event.contractAddress,
      BigInt(event.primaryPrice),
      tokenAddress,
    );

    if (!verified) {
      return reply.code(400).send({ error: "Transaction verification failed" });
    }

    // Create PendingMint for crypto payment
    const pendingMint = await prisma.pendingMint.create({
      data: {
        eventId,
        buyerEmail: user.userId,
        buyerWalletAddress,
        cryptoTxHash: txHash,
        paymentAmount: event.primaryPrice,
        paymentCurrency: currency,
        status: "PENDING",
      },
    });

    return reply.code(201).send({
      id: pendingMint.id,
      status: pendingMint.status,
      cryptoTxHash: txHash,
      currency,
    });
  });
}
