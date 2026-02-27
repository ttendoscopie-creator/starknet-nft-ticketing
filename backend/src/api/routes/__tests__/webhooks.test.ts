import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// Mock Prisma
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    pendingMint: { findUnique: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

// Mock Stripe
const { mockConstructEvent } = vi.hoisted(() => ({
  mockConstructEvent: vi.fn(),
}));

vi.mock("stripe", () => {
  return {
    default: vi.fn(() => ({
      webhooks: { constructEvent: mockConstructEvent },
    })),
  };
});

// Mock BullMQ Queue
const { mockQueueAdd } = vi.hoisted(() => ({
  mockQueueAdd: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(() => ({ add: mockQueueAdd })),
}));

// Mock Redis
vi.mock("../../../db/redis", () => ({
  bullmqConnection: { host: "localhost", port: 6379 },
}));

import { webhookRoutes } from "../webhooks";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(webhookRoutes);
  await app.ready();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /v1/webhooks/stripe", () => {
  it("returns 400 when stripe-signature header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      payload: Buffer.from("{}"),
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Missing stripe-signature header");
  });

  it("returns 400 when signature verification fails", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      payload: Buffer.from("{}"),
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=123,v1=abc",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Webhook Error");
  });

  it("returns 200 and skips when metadata is missing", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", metadata: {} } },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      payload: Buffer.from("{}"),
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=123,v1=abc",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().received).toBe(true);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 200 and skips duplicate payment intent", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test",
          payment_intent: "pi_existing",
          metadata: { event_id: "e1", buyer_email: "fan@test.com" },
        },
      },
    });
    mockPrisma.pendingMint.findUnique.mockResolvedValue({ id: "existing" });

    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      payload: Buffer.from("{}"),
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=123,v1=abc",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockPrisma.pendingMint.create).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 200 and queues mint job on valid checkout", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test",
          payment_intent: "pi_new",
          metadata: {
            event_id: "e1",
            buyer_email: "fan@test.com",
            buyer_wallet_address: "0xwallet",
          },
        },
      },
    });
    mockPrisma.pendingMint.findUnique.mockResolvedValue(null);
    mockPrisma.pendingMint.create.mockResolvedValue({
      id: "pm-1",
      eventId: "e1",
      buyerEmail: "fan@test.com",
    });
    mockQueueAdd.mockResolvedValue({});

    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      payload: Buffer.from("{}"),
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=123,v1=abc",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mockPrisma.pendingMint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: "e1",
          buyerEmail: "fan@test.com",
          stripePaymentIntentId: "pi_new",
          status: "PENDING",
        }),
      })
    );
    expect(mockQueueAdd).toHaveBeenCalledWith("mint", {
      pendingMintId: "pm-1",
      eventId: "e1",
      buyerEmail: "fan@test.com",
      buyerWalletAddress: "0xwallet",
    });
  });

  it("returns 200 for unhandled event types", async () => {
    mockConstructEvent.mockReturnValue({
      type: "payment_intent.created",
      data: { object: {} },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      payload: Buffer.from("{}"),
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=123,v1=abc",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().received).toBe(true);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});
