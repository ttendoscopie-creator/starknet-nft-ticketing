import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { authMiddleware } from "../middleware/auth";
import { createListingRateLimit } from "../middleware/rateLimit";

const CreateListingSchema = z.object({
  ticketId: z.string().uuid(),
  price: z.number().positive().max(1_000_000_000),
});

const UUIDParam = z.object({ id: z.string().uuid() });

export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  // Get active listings (public, paginated)
  app.get("/v1/marketplace/listings", async (request, reply) => {
    const query = request.query as { skip?: string; take?: string };
    const skip = Math.max(0, Number(query.skip) || 0);
    const take = Math.min(Math.max(1, Number(query.take) || 20), 100);

    const [listings, total] = await Promise.all([
      prisma.listing.findMany({
        where: { isActive: true },
        include: {
          ticket: {
            include: { event: { select: { name: true, eventDate: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.listing.count({ where: { isActive: true } }),
    ]);
    return reply.send({ listings, total, skip, take });
  });

  // Create a listing (authenticated)
  app.post(
    "/v1/marketplace/listings",
    { preHandler: authMiddleware, ...createListingRateLimit },
    async (request, reply) => {
      const parseResult = CreateListingSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ error: "Invalid input" });
      }

      const { ticketId, price } = parseResult.data;

      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { event: true },
      });
      if (!ticket) {
        return reply.code(404).send({ error: "Ticket not found" });
      }
      if (ticket.ownerAddress !== request.user!.walletAddress) {
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
      // SECURITY FIX (MED-06): Enforce resale price cap from event config
      const maxResalePrice = Number(ticket.event.primaryPrice) * ticket.event.resaleCapBps / 10000;
      if (price > maxResalePrice) {
        return reply.code(400).send({ error: `Price exceeds resale cap (max: ${maxResalePrice})` });
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
              sellerAddress: request.user!.walletAddress,
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
      const parsed = UUIDParam.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid listing ID format" });
      }

      const listing = await prisma.listing.findUnique({
        where: { id: parsed.data.id },
        include: { ticket: true },
      });
      if (!listing) {
        return reply.code(404).send({ error: "Listing not found" });
      }
      if (listing.sellerAddress !== request.user!.walletAddress) {
        return reply.code(403).send({ error: "Not the seller" });
      }
      if (!listing.isActive) {
        return reply.code(400).send({ error: "Listing already inactive" });
      }

      await prisma.$transaction([
        prisma.listing.update({
          where: { id: parsed.data.id },
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
