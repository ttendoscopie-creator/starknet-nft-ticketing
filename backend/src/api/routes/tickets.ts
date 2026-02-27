import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
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

  // Get all tickets for the authenticated user
  app.get("/v1/tickets", async (request, reply) => {
    const tickets = await getTicketsByOwner(request.user!.walletAddress);
    return reply.send(tickets);
  });

  // Get a specific ticket
  app.get("/v1/tickets/:id", async (request, reply) => {
    const parsed = UUIDParam.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid ticket ID format" });
    }

    const ticket = await getTicketById(parsed.data.id);
    if (!ticket) {
      return reply.code(404).send({ error: "Ticket not found" });
    }
    return reply.send(ticket);
  });

  // Get tickets for an event (organizer/staff)
  app.get("/v1/events/:eventId/tickets", async (request, reply) => {
    const parsed = EventIdParam.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid event ID format" });
    }

    const tickets = await getTicketsByEvent(parsed.data.eventId);
    return reply.send(tickets);
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
