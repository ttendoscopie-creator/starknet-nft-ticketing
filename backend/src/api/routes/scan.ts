import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getTicketById, logScan, updateTicketStatus } from "../../services/ticket.service";
import { getTicketCache, markTicketUsedAtomic, setTicketCache } from "../../db/redis";
import { verifyQRSignature, isTimestampValid } from "../../services/qr.service";
import { Queue } from "bullmq";
import { bullmqConnection } from "../../db/redis";
import { authMiddleware, staffOnly } from "../middleware/auth";
import { scanRateLimit } from "../middleware/rateLimit";

const markUsedQueue = new Queue("markUsed", {
  connection: bullmqConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
  },
});

const ScanValidateSchema = z.object({
  ticket_id: z.string().uuid(),
  signature: z.string().regex(/^[0-9a-f]{64}$/, "Invalid signature format"),
  timestamp: z.number().int().positive(),
  gate_id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
});

export async function scanRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/scan/validate", { preHandler: [authMiddleware, staffOnly], ...scanRateLimit }, async (request, reply) => {
    const parseResult = ScanValidateSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply
        .code(400)
        .send({ valid: false, reason: "INVALID_REQUEST", errors: parseResult.error.issues });
    }

    const { ticket_id, signature, timestamp, gate_id } = parseResult.data;

    // 1. Check timestamp (30s window, both bounds)
    if (!isTimestampValid(timestamp, 30)) {
      return reply.code(200).send({ valid: false, reason: "QR_EXPIRED" });
    }

    // 2. Verify signature
    if (!verifyQRSignature(ticket_id, timestamp, signature)) {
      return reply.code(200).send({ valid: false, reason: "INVALID_SIGNATURE" });
    }

    // 3. Get ticket from cache or DB
    let ticketData = await getTicketCache(ticket_id);
    if (!ticketData) {
      const ticket = await getTicketById(ticket_id);
      if (!ticket) {
        return reply.code(200).send({ valid: false, reason: "TICKET_NOT_FOUND" });
      }
      ticketData = {
        status: ticket.status,
        ownerAddress: ticket.ownerAddress,
        ownerName: ticket.ownerEmail ?? undefined,
      };
    }

    // 3b. SECURITY FIX (HIGH-05): Check ticket status before allowing scan
    if (ticketData.status === "USED" || ticketData.status === "REVOKED" || ticketData.status === "CANCELLED") {
      return reply.code(200).send({ valid: false, reason: "TICKET_NOT_VALID", status: ticketData.status });
    }
    if (ticketData.status === "LISTED") {
      return reply.code(200).send({ valid: false, reason: "TICKET_LISTED" });
    }

    // 4. Check not already used via Redis SET NX (atomic)
    const claimed = await markTicketUsedAtomic(ticket_id);
    if (!claimed) {
      return reply.code(200).send({ valid: false, reason: "ALREADY_USED" });
    }

    // 5. SECURITY FIX (HIGH-04): Synchronous DB status update (not fire-and-forget)
    try {
      await updateTicketStatus(ticket_id, "USED");
    } catch (err) {
      app.log.error({ err, ticket_id }, "Failed to update ticket status in DB");
      // Don't fail the scan — Redis SETNX is the primary guard
    }

    // 6. Update cache to reflect USED status
    await setTicketCache(ticket_id, { ...ticketData, status: "USED" }).catch(() => {});

    // 7. Log scan (still fire-and-forget — it's audit, not critical path)
    logScan({
      ticketId: ticket_id,
      gateId: gate_id,
    }).catch((err: unknown) => {
      app.log.error({ err, ticket_id }, "Failed to log scan");
    });

    // 8. Queue on-chain mark_used
    await markUsedQueue.add("markUsed", { ticketId: ticket_id });

    // 9. Return valid
    app.log.info({ ticket_id, gate_id }, "Ticket scan valid");
    return reply.code(200).send({
      valid: true,
      ticket_id,
      owner_name: ticketData.ownerName,
    });
  });
}
