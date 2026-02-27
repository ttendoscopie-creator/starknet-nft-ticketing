import Fastify from "fastify";
import cors from "@fastify/cors";
import { validateEnv } from "../config/env";
import { registerRateLimit } from "./middleware/rateLimit";
import { redis } from "../db/redis";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
import { scanRoutes } from "./routes/scan";
import { webhookRoutes } from "./routes/webhooks";
import { eventRoutes } from "./routes/events";
import { ticketRoutes } from "./routes/tickets";
import { marketplaceRoutes } from "./routes/marketplace";
import { paymentRoutes } from "./routes/payments";

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || "0.0.0.0";

async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      transport:
        process.env.NODE_ENV === "development"
          ? { target: "pino-pretty" }
          : undefined,
    },
  });

  // CORS
  await app.register(cors, {
    origin: process.env.FRONTEND_URL!,
    credentials: true,
  });

  // Rate limiting
  await registerRateLimit(app);

  // Health check
  app.get("/health", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      return reply.send({
        status: "ok",
        database: "connected",
        redis: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return reply.code(503).send({
        status: "error",
        message: err instanceof Error ? err.message : "Health check failed",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Routes — webhooks registered first (needs raw body parser)
  await app.register(webhookRoutes);
  await app.register(scanRoutes);
  await app.register(eventRoutes);
  await app.register(ticketRoutes);
  await app.register(marketplaceRoutes);
  await app.register(paymentRoutes);

  return app;
}

async function main() {
  validateEnv();
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Server listening on ${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();

export { buildApp };
