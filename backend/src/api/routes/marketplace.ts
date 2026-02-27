import { FastifyInstance } from "fastify";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, JWTPayload } from "../middleware/auth";

const prisma = new PrismaClient();

const CreateListingSchema = z.object({
  ticketId: z.string().uuid(),
  price: z.number().positive(),
});

export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  // Get active listings (public)
  app.get("/v1/marketplace/listings", async (_request, reply) => {
    const listings = await prisma.listing.findMany({
      where: { isActive: true },
      include: {
        ticket: {
          include: { event: { select: { name: true, eventDate: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return reply.send(listings);
  });

  // Create a listing (authenticated)
  app.post(
    "/v1/marketplace/listings",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const parseResult = CreateListingSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ error: "Invalid input", details: parseResult.error.issues });
      }

      const user = (request as unknown as { user: JWTPayload }).user;
      const { ticketId, price } = parseResult.data;

      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { event: true },
      });
      if (!ticket) {
        return reply.code(404).send({ error: "Ticket not found" });
      }
      if (ticket.ownerAddress !== user.walletAddress) {
        return reply.code(403).send({ error: "Not the ticket owner" });
      }
      if (ticket.status !== "AVAILABLE") {
        return reply.code(400).send({ error: "Ticket not available for listing" });
      }
      if (ticket.event.isSoulbound) {
        return reply.code(400).send({ error: "Soulbound tickets cannot be listed" });
      }
      if (ticket.event.maxTransfers > 0 && ticket.transferCount >= ticket.event.maxTransfers) {
        return reply.code(400).send({ error: "Maximum transfer limit reached" });
      }

      let listing;
      try {
        listing = await prisma.$transaction(async (tx) => {
          // Re-check status inside transaction to prevent race condition
          const freshTicket = await tx.ticket.findUnique({ where: { id: ticketId } });
          if (!freshTicket || freshTicket.status !== "AVAILABLE") {
            throw new Error("TICKET_NOT_AVAILABLE");
          }

          const created = await tx.listing.create({
            data: {
              ticketId,
              sellerAddress: user.walletAddress,
              price,
            },
          });
          await tx.ticket.update({
            where: { id: ticketId },
            data: { status: "LISTED" },
          });
          return created;
        });
      } catch (err) {
        if (err instanceof Error && err.message === "TICKET_NOT_AVAILABLE") {
          return reply.code(409).send({ error: "Ticket is no longer available" });
        }
        throw err;
      }

      return reply.code(201).send(listing);
    }
  );

  // Cancel a listing (authenticated)
  app.delete(
    "/v1/marketplace/listings/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = (request as unknown as { user: JWTPayload }).user;

      const listing = await prisma.listing.findUnique({
        where: { id },
        include: { ticket: true },
      });
      if (!listing) {
        return reply.code(404).send({ error: "Listing not found" });
      }
      if (listing.sellerAddress !== user.walletAddress) {
        return reply.code(403).send({ error: "Not the seller" });
      }
      if (!listing.isActive) {
        return reply.code(400).send({ error: "Listing already inactive" });
      }

      await prisma.$transaction([
        prisma.listing.update({
          where: { id },
          data: { isActive: false },
        }),
        prisma.ticket.update({
          where: { id: listing.ticketId },
          data: { status: "AVAILABLE" },
        }),
      ]);

      return reply.send({ success: true });
    }
  );
}
