import { FastifyInstance } from "fastify";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authMiddleware, organizerOnly, JWTPayload } from "../middleware/auth";

const prisma = new PrismaClient();

const CreateEventSchema = z.object({
  name: z.string().min(1).max(200),
  eventDate: z.string().datetime(),
  maxSupply: z.number().int().positive().max(100000),
  primaryPrice: z.number().int().positive().default(1000000),
  resaleCapBps: z.number().int().min(10000).max(50000).default(11000),
  royaltyBps: z.number().int().min(0).max(2000).default(1000),
  metadataBaseUri: z.string().url().optional(),
  isSoulbound: z.boolean().default(false),
  maxTransfers: z.number().int().min(0).max(100).default(0),
  acceptedCurrencies: z.array(z.enum(["STRK", "USDC", "USDT"])).default(["STRK"]),
  paymentTokenAddress: z.string().optional(),
});

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", authMiddleware);

  app.post(
    "/v1/events",
    { preHandler: organizerOnly },
    async (request, reply) => {
      const parseResult = CreateEventSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({ error: "Invalid input", details: parseResult.error.issues });
      }

      const user = (request as unknown as { user: JWTPayload }).user;
      const data = parseResult.data;

      const organizer = await prisma.organizer.findFirst({
        where: { id: user.userId },
      });
      if (!organizer) {
        return reply.code(404).send({ error: "Organizer not found" });
      }

      const event = await prisma.event.create({
        data: {
          organizerId: organizer.id,
          contractAddress: "0x0", // Updated after on-chain deployment
          name: data.name,
          eventDate: new Date(data.eventDate),
          maxSupply: data.maxSupply,
          primaryPrice: BigInt(data.primaryPrice),
          resaleCapBps: data.resaleCapBps,
          royaltyBps: data.royaltyBps,
          metadataBaseUri: data.metadataBaseUri,
          isSoulbound: data.isSoulbound,
          maxTransfers: data.maxTransfers,
          acceptedCurrencies: data.acceptedCurrencies,
          paymentTokenAddress: data.paymentTokenAddress,
        },
      });

      return reply.code(201).send(event);
    }
  );

  app.get("/v1/events", async (_request, reply) => {
    const events = await prisma.event.findMany({
      orderBy: { eventDate: "asc" },
      include: { _count: { select: { tickets: true } } },
    });
    return reply.send(events);
  });

  app.get("/v1/events/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        organizer: { select: { name: true } },
        _count: { select: { tickets: true } },
      },
    });
    if (!event) {
      return reply.code(404).send({ error: "Event not found" });
    }
    return reply.send(event);
  });
}
