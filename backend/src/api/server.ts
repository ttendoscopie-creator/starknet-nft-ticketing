import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerRateLimit } from "./middleware/rateLimit";
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
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  });

  // Rate limiting
  await registerRateLimit(app);

  // Health check
  app.get("/health", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

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
