import { FastifyInstance } from "fastify";
import { authMiddleware } from "../middleware/auth";
import { redis } from "../../db/redis";
import { logger } from "../../config/logger";

const AVNU_PAYMASTER_URL =
  process.env.AVNU_PAYMASTER_URL || "https://starknet.paymaster.avnu.fi";
const MAX_SPONSORED_TXS_PER_DAY = Number(
  process.env.MAX_SPONSORED_TXS_PER_DAY,
) || 20;

export async function paymasterRoutes(app: FastifyInstance): Promise<void> {
  // OpenAPI tag
  app.addSchema({
    $id: "PaymasterTag",
    type: "object",
    description: "AVNU Paymaster proxy with per-user rate limiting",
  });

  app.post(
    "/v1/paymaster",
    {
      preHandler: authMiddleware,
      schema: {
        tags: ["Paymaster"],
        summary: "Proxy gasless transaction to AVNU Paymaster",
        security: [{ bearerAuth: [] }],
        response: {
          200: { type: "object", additionalProperties: true },
          429: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          502: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const walletAddress = request.user!.walletAddress;

      // Redis-based daily rate limiting per user
      const today = new Date().toISOString().slice(0, 10);
      const rateLimitKey = `paymaster:daily:${walletAddress}:${today}`;
      const count = await redis.incr(rateLimitKey);
      if (count === 1) {
        await redis.expire(rateLimitKey, 86400);
      }
      if (count > MAX_SPONSORED_TXS_PER_DAY) {
        return reply.code(429).send({
          error: "Daily sponsored transaction limit reached",
        });
      }

      // Lookup organizer AVNU API key if available
      // For now, fall back to no key (gasless mode, user pays in supported tokens)
      const apiKey = ""; // Future: lookup from organizer.avnuApiKey

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (apiKey) {
          headers["x-paymaster-api-key"] = apiKey;
        }

        const response = await fetch(AVNU_PAYMASTER_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(request.body),
        });

        const data = await response.json();
        const status = response.status as 200 | 429 | 502;
        return reply.code(status).send(data);
      } catch (err) {
        logger.error({ err, walletAddress }, "AVNU paymaster proxy failed");
        return reply
          .code(502)
          .send({ error: "Paymaster service unavailable" });
      }
    },
  );
}
