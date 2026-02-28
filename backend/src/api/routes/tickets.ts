import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware, organizerOnly } from "../middleware/auth";
import {
  getTicketsByOwner,
  getTicketsByEvent,
  getTicketById,
} from "../../services/ticket.service";
import { generateQRPayload, generateQRDataUrl } from "../../services/qr.service";

const UUIDParam = z.object({ id: z.string().uuid() });
const EventIdParam = z.object({ eventId: z.string().uuid() });

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", authMiddleware);

  // Get all tickets for the authenticated user (paginated)
  app.get("/v1/tickets", async (request, reply) => {
    const query = request.query as { skip?: string; take?: string };
    const skip = Math.max(0, Number(query.skip) || 0);
    const take = Math.min(Math.max(1, Number(query.take) || 20), 100);

    const { tickets, total } = await getTicketsByOwner(request.user!.walletAddress, skip, take);
    return reply.send({ tickets, total, skip, take });
  });

  // Get a specific ticket (ownership check)
  app.get("/v1/tickets/:id", async (request, reply) => {
    const parsed = UUIDParam.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid ticket ID format" });
    }

    const ticket = await getTicketById(parsed.data.id);
    if (!ticket) {
      return reply.code(404).send({ error: "Ticket not found" });
    }

    // SECURITY FIX (HIGH-06): Ownership check — only owner can view full details
    if (ticket.ownerAddress !== request.user!.walletAddress) {
      return reply.code(403).send({ error: "Not the ticket owner" });
    }

    return reply.send(ticket);
  });

  // Get tickets for an event (organizer only)
  app.get("/v1/events/:eventId/tickets", { preHandler: [organizerOnly] }, async (request, reply) => {
    const parsed = EventIdParam.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid event ID format" });
    }

    const query = request.query as { skip?: string; take?: string };
    const skip = Math.max(0, Number(query.skip) || 0);
    const take = Math.min(Math.max(1, Number(query.take) || 20), 100);

    const { tickets, total } = await getTicketsByEvent(parsed.data.eventId, skip, take);
    return reply.send({ tickets, total, skip, take });
  });

  // Generate QR code for a ticket
  app.get("/v1/tickets/:id/qr", async (request, reply) => {
    const parsed = UUIDParam.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid ticket ID format" });
    }

    const ticket = await getTicketById(parsed.data.id);
    if (!ticket) {
      return reply.code(404).send({ error: "Ticket not found" });
    }
    if (ticket.ownerAddress !== request.user!.walletAddress) {
      return reply.code(403).send({ error: "Not the ticket owner" });
    }
    if (ticket.status === "USED") {
      return reply.code(400).send({ error: "Ticket already used" });
    }

    const payload = generateQRPayload(parsed.data.id);
    return reply.send(payload);
  });

  // Generate QR code image as data URL
  app.get("/v1/tickets/:id/qr-image", async (request, reply) => {
    const parsed = UUIDParam.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid ticket ID format" });
    }

    const ticket = await getTicketById(parsed.data.id);
    if (!ticket) {
      return reply.code(404).send({ error: "Ticket not found" });
    }
    if (ticket.ownerAddress !== request.user!.walletAddress) {
      return reply.code(403).send({ error: "Not the ticket owner" });
    }

    const dataUrl = await generateQRDataUrl(parsed.data.id);
    return reply.send({ qr: dataUrl });
  });
}
