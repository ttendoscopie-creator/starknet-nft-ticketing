import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { validateEnv } from "../config/env";
import { registerRateLimit } from "./middleware/rateLimit";
import { redis } from "../db/redis";
import { prisma } from "../db/prisma";
import { logger } from "../config/logger";
import { register, httpRequestsTotal, httpRequestDuration } from "./metrics";
import { scanRoutes } from "./routes/scan";
import { webhookRoutes } from "./routes/webhooks";
import { eventRoutes } from "./routes/events";
import { ticketRoutes } from "./routes/tickets";
import { marketplaceRoutes } from "./routes/marketplace";
import { paymentRoutes } from "./routes/payments";
import { paymasterRoutes } from "./routes/paymaster";
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

  // Correlation ID for request tracing
  app.addHook("onRequest", async (request) => {
    request.id = request.headers["x-request-id"] as string || request.id;
    request.log = request.log.child({ requestId: request.id });
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

  // OpenAPI / Swagger documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Starknet NFT Ticketing API",
        description: "REST API for NFT-based event ticketing on Starknet",
        version: "2.0.0",
      },
      servers: [
        { url: `http://localhost:${PORT}`, description: "Local" },
      ],
      tags: [
        { name: "Events", description: "Event management" },
        { name: "Tickets", description: "Ticket operations" },
        { name: "Marketplace", description: "P2P ticket resale" },
        { name: "Scan", description: "QR code scanning & validation" },
        { name: "Payments", description: "Crypto payment verification" },
        { name: "Bridge", description: "External ticketing bridge (Digital Twin)" },
        { name: "Webhooks", description: "Stripe webhook handler" },
        { name: "Paymaster", description: "AVNU gasless transaction proxy" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  // Prometheus metrics endpoint
  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", register.contentType);
    return reply.send(await register.metrics());
  });

  // Metrics collection hooks
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions?.url || request.url;
    const method = request.method;
    const statusCode = reply.statusCode.toString();
    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    httpRequestDuration.observe(
      { method, route, status_code: statusCode },
      reply.elapsedTime / 1000,
    );
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
  await app.register(paymasterRoutes);

  // Global error handler — consistent error responses, no stack trace leaks
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    request.log.error({ err: error, url: request.url, method: request.method }, "Unhandled error");
    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : error.message,
      statusCode,
    });
  });

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
