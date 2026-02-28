import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { validateEnv } from "../config/env";
import { registerRateLimit } from "./middleware/rateLimit";
import { redis } from "../db/redis";
import { prisma } from "../db/prisma";
import { logger } from "../config/logger";
import { scanRoutes } from "./routes/scan";
import { webhookRoutes } from "./routes/webhooks";
import { eventRoutes } from "./routes/events";
import { ticketRoutes } from "./routes/tickets";
import { marketplaceRoutes } from "./routes/marketplace";
import { paymentRoutes } from "./routes/payments";
import { bridgeRoutes } from "./routes/bridge";

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || "0.0.0.0";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

async function buildApp() {
  const app = Fastify({
    trustProxy: true, // SECURITY FIX (MED-12): Enable trust proxy for correct IP-based rate limiting
    logger: {
      level: process.env.LOG_LEVEL || "info",
      transport:
        process.env.NODE_ENV === "development"
          ? { target: "pino-pretty" }
          : undefined,
    },
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false, // handled by frontend/Next.js
  });

  // CORS
  await app.register(cors, {
    origin: process.env.FRONTEND_URL!,
    credentials: true,
  });

  // BigInt serialization — convert BigInt to string in JSON responses
  app.addHook("preSerialization", async (_request, _reply, payload) => {
    return JSON.parse(
      JSON.stringify(payload, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );
  });

  // Rate limiting
  await registerRateLimit(app);

  // Health check with timeouts
  app.get("/health", async (_request, reply) => {
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, 5000);
      await withTimeout(redis.ping(), 5000);
      return reply.send({
        status: "ok",
        database: "connected",
        redis: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return reply.code(503).send({
        status: "error",
        message: "Health check failed",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Routes — webhooks/bridge registered first (need raw body parser)
  await app.register(webhookRoutes);
  await app.register(bridgeRoutes);
  await app.register(scanRoutes);
  await app.register(eventRoutes);
  await app.register(ticketRoutes);
  await app.register(marketplaceRoutes);
  await app.register(paymentRoutes);

  return app;
}

async function main() {
  validateEnv();

  // Verify database connection before starting
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    logger.error({ err }, "Failed to connect to database on startup");
    process.exit(1);
  }

  const app = await buildApp();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Received shutdown signal, closing server...");
    try {
      await app.close();
      await prisma.$disconnect();
      logger.info("Server closed gracefully");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

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
