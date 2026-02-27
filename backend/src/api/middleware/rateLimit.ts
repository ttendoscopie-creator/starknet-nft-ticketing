import rateLimit from "@fastify/rate-limit";
import { FastifyInstance } from "fastify";

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (request) => {
      return request.ip;
    },
  });
}

// Per-endpoint rate limit configs (used in route options)
export const scanRateLimit = {
  config: {
    rateLimit: {
      max: 30,
      timeWindow: "1 minute",
    },
  },
};

export const paymentRateLimit = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: "1 minute",
    },
  },
};

export const webhookRateLimit = {
  config: {
    rateLimit: {
      max: 50,
      timeWindow: "1 minute",
    },
  },
};

export const createEventRateLimit = {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: "1 minute",
    },
  },
};

export const createListingRateLimit = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: "1 minute",
    },
  },
};
