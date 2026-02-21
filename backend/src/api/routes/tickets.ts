import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authMiddleware, JWTPayload } from "../middleware/auth";
import {
  getTicketsByOwner,
  getTicketsByEvent,
  getTicketById,
} from "../../services/ticket.service";
import { generateQRPayload, generateQRDataUrl } from "../../services/qr.service";

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", authMiddleware);

  // Get all tickets for the authenticated user
  app.get("/v1/tickets", async (request, reply) => {
    const user = (request as unknown as { user: JWTPayload }).user;
    const tickets = await getTicketsByOwner(user.walletAddress);
    return reply.send(tickets);
  });

  // Get a specific ticket
  app.get("/v1/tickets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ticket = await getTicketById(id);
    if (!ticket) {
      return reply.code(404).send({ error: "Ticket not found" });
    }
    return reply.send(ticket);
  });

  // Get tickets for an event (organizer/staff)
  app.get("/v1/events/:eventId/tickets", async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const tickets = await getTicketsByEvent(eventId);
    return reply.send(tickets);
  });

  // Generate QR code for a ticket
  app.get("/v1/tickets/:id/qr", async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as unknown as { user: JWTPayload }).user;

    const ticket = await getTicketById(id);
    if (!ticket) {
      return reply.code(404).send({ error: "Ticket not found" });
    }
    if (ticket.ownerAddress !== user.walletAddress) {
      return reply.code(403).send({ error: "Not the ticket owner" });
    }
    if (ticket.status === "USED") {
      return reply.code(400).send({ error: "Ticket already used" });
    }

    const payload = generateQRPayload(id);
    return reply.send(payload);
  });

  // Generate QR code image as data URL
  app.get("/v1/tickets/:id/qr-image", async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as unknown as { user: JWTPayload }).user;

    const ticket = await getTicketById(id);
    if (!ticket) {
      return reply.code(404).send({ error: "Ticket not found" });
    }
    if (ticket.ownerAddress !== user.walletAddress) {
      return reply.code(403).send({ error: "Not the ticket owner" });
    }

    const dataUrl = await generateQRDataUrl(id);
    return reply.send({ qr: dataUrl });
  });
}
