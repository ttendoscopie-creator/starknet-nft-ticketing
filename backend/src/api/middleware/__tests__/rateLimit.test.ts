import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @fastify/rate-limit before importing the module under test
vi.mock("@fastify/rate-limit", () => ({
  default: vi.fn(),
}));

import rateLimit from "@fastify/rate-limit";
import {
  registerRateLimit,
  scanRateLimit,
  paymentRateLimit,
  bridgeWebhookRateLimit,
  bridgeClaimRateLimit,
  createEventRateLimit,
  createListingRateLimit,
} from "../rateLimit";

describe("registerRateLimit", () => {
  it("registers @fastify/rate-limit with default 100/min global limit", async () => {
    const fakeApp = {
      register: vi.fn(),
    } as any;

    await registerRateLimit(fakeApp);

    expect(fakeApp.register).toHaveBeenCalledWith(rateLimit, {
      max: 100,
      timeWindow: "1 minute",
      keyGenerator: expect.any(Function),
    });
  });

  it("keyGenerator returns request.ip", async () => {
    const fakeApp = {
      register: vi.fn(),
    } as any;

    await registerRateLimit(fakeApp);

    const options = fakeApp.register.mock.calls[0][1];
    const fakeRequest = { ip: "192.168.1.42" };
    expect(options.keyGenerator(fakeRequest)).toBe("192.168.1.42");
  });
});

describe("per-endpoint rate limit configs", () => {
  it("scanRateLimit config has max 30", () => {
    expect(scanRateLimit.config.rateLimit.max).toBe(30);
    expect(scanRateLimit.config.rateLimit.timeWindow).toBe("1 minute");
  });

  it("paymentRateLimit config has max 10", () => {
    expect(paymentRateLimit.config.rateLimit.max).toBe(10);
    expect(paymentRateLimit.config.rateLimit.timeWindow).toBe("1 minute");
  });

  it("bridgeWebhookRateLimit config has max 100", () => {
    expect(bridgeWebhookRateLimit.config.rateLimit.max).toBe(100);
    expect(bridgeWebhookRateLimit.config.rateLimit.timeWindow).toBe("1 minute");
  });

  it("bridgeClaimRateLimit config has max 10", () => {
    expect(bridgeClaimRateLimit.config.rateLimit.max).toBe(10);
    expect(bridgeClaimRateLimit.config.rateLimit.timeWindow).toBe("1 minute");
  });

  it("createEventRateLimit config has max 5", () => {
    expect(createEventRateLimit.config.rateLimit.max).toBe(5);
    expect(createEventRateLimit.config.rateLimit.timeWindow).toBe("1 minute");
  });

  it("createListingRateLimit config has max 10", () => {
    expect(createListingRateLimit.config.rateLimit.max).toBe(10);
    expect(createListingRateLimit.config.rateLimit.timeWindow).toBe("1 minute");
  });
});
