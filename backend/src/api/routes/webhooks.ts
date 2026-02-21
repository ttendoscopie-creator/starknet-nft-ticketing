import { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import { bullmqConnection } from "../../db/redis";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const prisma = new PrismaClient();
const mintQueue = new Queue("mint", { connection: bullmqConnection });

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  // Raw body needed for Stripe signature verification
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    }
  );

  app.post("/v1/webhooks/stripe", async (request, reply) => {
    const sig = request.headers["stripe-signature"];
    if (!sig) {
      return reply.code(400).send({ error: "Missing stripe-signature header" });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body as Buffer,
        sig,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      app.log.warn({ err: message }, "Stripe webhook signature verification failed");
      return reply.code(400).send({ error: `Webhook Error: ${message}` });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata;

      if (!metadata?.event_id || !metadata?.buyer_email) {
        app.log.warn({ sessionId: session.id }, "Missing metadata in Stripe session");
        return reply.code(200).send({ received: true });
      }

      try {
        // Create pending mint record
        const pendingMint = await prisma.pendingMint.create({
          data: {
            eventId: metadata.event_id,
            stripePaymentIntentId: session.payment_intent as string,
            buyerEmail: metadata.buyer_email,
            buyerWalletAddress: metadata.buyer_wallet_address ?? null,
            status: "PENDING",
          },
        });

        // Queue mint job
        await mintQueue.add("mint", {
          pendingMintId: pendingMint.id,
          eventId: metadata.event_id,
          buyerEmail: metadata.buyer_email,
          buyerWalletAddress: metadata.buyer_wallet_address,
        });

        app.log.info(
          { pendingMintId: pendingMint.id, eventId: metadata.event_id },
          "Mint job queued"
        );
      } catch (err) {
        app.log.error({ err, sessionId: session.id }, "Failed to process checkout session");
      }
    }

    return reply.code(200).send({ received: true });
  });
}
