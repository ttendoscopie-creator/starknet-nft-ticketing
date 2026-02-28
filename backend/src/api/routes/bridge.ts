import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { verifyBridgeSignature } from "../../services/bridge.service";
import { bridgeMintQueue, bridgeClaimQueue } from "../../queue/bridge.worker";
import { authMiddleware } from "../middleware/auth";
import { bridgeWebhookRateLimit, bridgeClaimRateLimit } from "../middleware/rateLimit";
import { logger } from "../../config/logger";

// --- Validation schemas ---

const BridgeWebhookSchema = z.object({
  external_ticket_id: z.string().min(1).max(500),
  email: z.string().email().max(320),
  pass_type: z.string().max(100).optional(),
  event_id: z.string().uuid(),
  organizer_id: z.string().uuid(),
  metadata: z.record(z.unknown()).optional(),
});

const BridgeClaimSchema = z.object({
  event_id: z.string().uuid().optional(),
});

const UUIDParam = z.object({ id: z.string().uuid() });

// --- Routes ---

export async function bridgeRoutes(app: FastifyInstance): Promise<void> {
  // Webhook needs raw body parser — register in its own encapsulated scope
  await app.register(bridgeWebhookRoute);

  // JSON-body routes (claim, status, tickets)
  await app.register(bridgeJsonRoutes);
}

// ── Webhook (raw body scope) ──────────────────────────────────────────

async function bridgeWebhookRoute(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    }
  );

  app.post("/v1/bridge/webhook", { ...bridgeWebhookRateLimit }, async (request, reply) => {
    const sig = request.headers["x-bridge-signature"] as string | undefined;
    if (!sig) {
      return reply.code(400).send({ error: "Missing X-Bridge-Signature header" });
    }

    const rawBody = request.body as Buffer;
    let parsed: z.infer<typeof BridgeWebhookSchema>;
    try {
      parsed = BridgeWebhookSchema.parse(JSON.parse(rawBody.toString()));
    } catch {
      return reply.code(400).send({ error: "Invalid payload" });
    }

    // Verify signature BEFORE organizer lookup to prevent oracle attacks
    const organizer = await prisma.organizer.findUnique({
      where: { id: parsed.organizer_id },
    });

    // Return uniform response whether organizer exists or not (prevents enumeration)
    if (!organizer || !verifyBridgeSignature(rawBody, sig, organizer.apiKey)) {
      return reply.code(401).send({ error: "Invalid signature" });
    }

    const event = await prisma.event.findUnique({
      where: { id: parsed.event_id },
    });
    if (!event || event.organizerId !== organizer.id) {
      logger.warn(
        { eventId: parsed.event_id, organizerId: organizer.id },
        "Bridge webhook: event not found or not owned by organizer"
      );
      return reply.code(200).send({ received: true });
    }

    if (event.isSoulbound) {
      return reply.code(400).send({ error: "Soulbound events cannot be bridged" });
    }

    // Idempotent: handle duplicate via try/catch on unique constraint
    let bridgedTicket;
    try {
      bridgedTicket = await prisma.bridgedTicket.create({
        data: {
          externalTicketId: parsed.external_ticket_id,
          eventId: parsed.event_id,
          organizerId: organizer.id,
          ownerEmail: parsed.email,
          passType: parsed.pass_type ?? null,
          externalMetadata: parsed.metadata as Prisma.InputJsonValue ?? undefined,
          status: "PENDING",
        },
      });
    } catch (err) {
      // Handle duplicate (unique constraint violation) — idempotent 200
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existing = await prisma.bridgedTicket.findUnique({
          where: {
            externalTicketId_organizerId: {
              externalTicketId: parsed.external_ticket_id,
              organizerId: organizer.id,
            },
          },
        });
        logger.info(
          { externalTicketId: parsed.external_ticket_id, status: existing?.status },
          "Bridge webhook: duplicate, skipping"
        );
        return reply.code(200).send({ received: true, bridgedTicketId: existing?.id, status: existing?.status });
      }
      throw err;
    }

    await bridgeMintQueue.add("bridgeMint", {
      bridgedTicketId: bridgedTicket.id,
      eventId: parsed.event_id,
      ownerEmail: parsed.email,
    });

    logger.info(
      { bridgedTicketId: bridgedTicket.id, externalTicketId: parsed.external_ticket_id },
      "Bridge mint job queued"
    );

    return reply.code(200).send({ received: true, bridgedTicketId: bridgedTicket.id });
  });
}

// ── JSON routes (claim, status, tickets) ──────────────────────────────

async function bridgeJsonRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/bridge/claim — User claims bridged tickets (uses email from JWT)
  app.post(
    "/v1/bridge/claim",
    { ...bridgeClaimRateLimit, preHandler: [authMiddleware] },
    async (request, reply) => {
      const bodyResult = BridgeClaimSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.code(400).send({ error: "Invalid input" });
      }

      const { event_id } = bodyResult.data;
      // SECURITY FIX (CRIT-01): Use email from verified JWT, not from request body
      const email = request.user!.email;
      const walletAddress = request.user!.walletAddress;

      if (!email) {
        return reply.code(400).send({ error: "JWT missing email claim" });
      }

      // Atomically transition MINTED → CLAIMING to prevent double-claim race
      const where: Prisma.BridgedTicketWhereInput = {
        ownerEmail: email,
        status: "MINTED",
      };
      if (event_id) {
        where.eventId = event_id;
      }

      const updated = await prisma.bridgedTicket.updateMany({
        where,
        data: { status: "CLAIMING" },
      });

      if (updated.count === 0) {
        return reply.code(200).send({ claimed: 0, tickets: [] });
      }

      // Fetch the tickets that were just transitioned to CLAIMING
      const bridgedTickets = await prisma.bridgedTicket.findMany({
        where: {
          ownerEmail: email,
          status: "CLAIMING",
          ...(event_id ? { eventId: event_id } : {}),
        },
      });

      const tickets = [];
      for (const bt of bridgedTickets) {
        await bridgeClaimQueue.add("bridgeClaim", {
          bridgedTicketId: bt.id,
          toAddress: walletAddress,
        });
        tickets.push({
          bridgedTicketId: bt.id,
          eventId: bt.eventId,
          tokenId: bt.tokenId,
          passType: bt.passType,
        });
      }

      logger.info(
        { email, count: bridgedTickets.length, walletAddress },
        "Bridge claim jobs queued"
      );

      return reply.code(200).send({ claimed: bridgedTickets.length, tickets });
    }
  );

  // GET /v1/bridge/status/:id — Check bridged ticket status (ownership check)
  app.get(
    "/v1/bridge/status/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const paramResult = UUIDParam.safeParse(request.params);
      if (!paramResult.success) {
        return reply.code(400).send({ error: "Invalid ID format" });
      }

      const bridgedTicket = await prisma.bridgedTicket.findUnique({
        where: { id: paramResult.data.id },
      });

      if (!bridgedTicket) {
        return reply.code(404).send({ error: "Bridged ticket not found" });
      }

      // SECURITY FIX (HIGH-07): Only allow owner or claimer to view
      const userEmail = request.user!.email;
      const userWallet = request.user!.walletAddress;
      if (bridgedTicket.ownerEmail !== userEmail && bridgedTicket.claimedByAddress !== userWallet) {
        return reply.code(404).send({ error: "Bridged ticket not found" });
      }

      return reply.send({
        id: bridgedTicket.id,
        status: bridgedTicket.status,
        tokenId: bridgedTicket.tokenId,
        eventId: bridgedTicket.eventId,
        passType: bridgedTicket.passType,
        mintTxHash: bridgedTicket.mintTxHash,
        claimTxHash: bridgedTicket.claimTxHash,
        createdAt: bridgedTicket.createdAt,
      });
    }
  );

  // GET /v1/bridge/tickets — List user's bridged tickets
  app.get(
    "/v1/bridge/tickets",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const userEmail = request.user!.email;
      const walletAddress = request.user!.walletAddress;

      const bridgedTickets = await prisma.bridgedTicket.findMany({
        where: {
          OR: [
            { ownerEmail: userEmail },
            { claimedByAddress: walletAddress },
          ],
        },
        orderBy: { createdAt: "desc" },
      });

      return reply.send({ tickets: bridgedTickets, total: bridgedTickets.length });
    }
  );
}
