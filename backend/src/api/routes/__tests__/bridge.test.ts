import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { makeToken } from "../../../__tests__/helpers";

// --- Hoisted mocks ---

const { mockPrisma, mockBridgeMintQueueAdd, mockBridgeClaimQueueAdd } = vi.hoisted(() => ({
  mockPrisma: {
    organizer: { findUnique: vi.fn() },
    event: { findUnique: vi.fn() },
    bridgedTicket: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  mockBridgeMintQueueAdd: vi.fn(),
  mockBridgeClaimQueueAdd: vi.fn(),
}));

vi.mock("../../../db/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../../queue/bridge.worker", () => ({
  bridgeMintQueue: { add: mockBridgeMintQueueAdd },
  bridgeClaimQueue: { add: mockBridgeClaimQueueAdd },
}));

vi.mock("../../../config/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { bridgeRoutes } from "../bridge";

// --- Test data ---

const API_KEY = "test-api-key-for-bridge-hmac";
const ORGANIZER_ID = "110e8400-e29b-41d4-a716-446655440000";
const EVENT_ID = "220e8400-e29b-41d4-a716-446655440000";
const BRIDGED_TICKET_ID = "330e8400-e29b-41d4-a716-446655440000";

function makeHmacSignature(body: string, key: string): string {
  return "sha256=" + crypto.createHmac("sha256", key).update(body).digest("hex");
}

const validWebhookPayload = {
  external_ticket_id: "EVT-12345",
  email: "buyer@example.com",
  pass_type: "VIP",
  event_id: EVENT_ID,
  organizer_id: ORGANIZER_ID,
};

const mockOrganizer = {
  id: ORGANIZER_ID,
  name: "Test Org",
  apiKey: API_KEY,
};

const mockEvent = {
  id: EVENT_ID,
  organizerId: ORGANIZER_ID,
  contractAddress: "0xdeployed",
  isSoulbound: false,
};

let app: FastifyInstance;
const fanToken = makeToken({ userId: "u1", walletAddress: "0xfan_wallet", role: "fan" });

beforeAll(async () => {
  app = Fastify();
  await app.register(bridgeRoutes);
  await app.ready();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Webhook tests ─────────────────────────────────────────────────────

describe("POST /v1/bridge/webhook", () => {
  it("returns 400 when X-Bridge-Signature header is missing", async () => {
    const body = JSON.stringify(validWebhookPayload);
    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Missing");
  });

  it("returns 400 when payload validation fails", async () => {
    const body = JSON.stringify({ bad: "data" });
    const sig = makeHmacSignature(body, API_KEY);
    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": sig,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Invalid payload");
  });

  it("returns 401 when organizer is not found", async () => {
    const body = JSON.stringify(validWebhookPayload);
    const sig = makeHmacSignature(body, API_KEY);
    mockPrisma.organizer.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": sig,
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Invalid signature");
  });

  it("returns 401 when signature is invalid", async () => {
    const body = JSON.stringify(validWebhookPayload);
    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": "sha256=000000000000000000000000000000000000000000000000000000000000dead",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("Invalid signature");
  });

  it("returns 400 when event is soulbound", async () => {
    const body = JSON.stringify(validWebhookPayload);
    const sig = makeHmacSignature(body, API_KEY);
    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);
    mockPrisma.event.findUnique.mockResolvedValue({ ...mockEvent, isSoulbound: true });
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": sig,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("Soulbound");
  });

  it("returns 200 with idempotent response for duplicate webhook (P2002)", async () => {
    const body = JSON.stringify(validWebhookPayload);
    const sig = makeHmacSignature(body, API_KEY);
    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);
    mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
    // Simulate unique constraint violation on create using the real Prisma error class
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "5.0.0" }
    );
    mockPrisma.bridgedTicket.create.mockRejectedValue(prismaError);
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: BRIDGED_TICKET_ID,
      status: "MINTED",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": sig,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().bridgedTicketId).toBe(BRIDGED_TICKET_ID);
    expect(mockBridgeMintQueueAdd).not.toHaveBeenCalled();
  });

  it("creates bridged ticket and queues mint job on valid webhook", async () => {
    const body = JSON.stringify(validWebhookPayload);
    const sig = makeHmacSignature(body, API_KEY);
    mockPrisma.organizer.findUnique.mockResolvedValue(mockOrganizer);
    mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue(null);
    mockPrisma.bridgedTicket.create.mockResolvedValue({
      id: BRIDGED_TICKET_ID,
      externalTicketId: "EVT-12345",
      status: "PENDING",
    });
    mockBridgeMintQueueAdd.mockResolvedValue({});

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/webhook",
      payload: Buffer.from(body),
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": sig,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().bridgedTicketId).toBe(BRIDGED_TICKET_ID);

    expect(mockPrisma.bridgedTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalTicketId: "EVT-12345",
          eventId: EVENT_ID,
          organizerId: ORGANIZER_ID,
          ownerEmail: "buyer@example.com",
          passType: "VIP",
          status: "PENDING",
        }),
      })
    );

    expect(mockBridgeMintQueueAdd).toHaveBeenCalledWith("bridgeMint", {
      bridgedTicketId: BRIDGED_TICKET_ID,
      eventId: EVENT_ID,
      ownerEmail: "buyer@example.com",
    });
  });
});

// ── Claim tests ───────────────────────────────────────────────────────

describe("POST /v1/bridge/claim", () => {
  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: { email: "buyer@example.com" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when JWT has no email claim", async () => {
    const noEmailToken = makeToken({ userId: "u1", walletAddress: "0xfan_wallet", role: "fan", email: undefined as any });
    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: {},
      headers: { authorization: `Bearer ${noEmailToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("JWT missing email claim");
  });

  it("returns 200 with claimed:0 when no tickets found", async () => {
    mockPrisma.bridgedTicket.updateMany.mockResolvedValue({ count: 0 });

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: {},
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().claimed).toBe(0);
    expect(res.json().tickets).toHaveLength(0);
  });

  it("queues claim jobs for all MINTED tickets", async () => {
    mockPrisma.bridgedTicket.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.bridgedTicket.findMany.mockResolvedValue([
      { id: "bt-1", eventId: EVENT_ID, tokenId: "1", passType: "VIP" },
      { id: "bt-2", eventId: EVENT_ID, tokenId: "2", passType: "GA" },
    ]);
    mockBridgeClaimQueueAdd.mockResolvedValue({});

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: {},
      headers: { authorization: `Bearer ${fanToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().claimed).toBe(2);

    expect(mockBridgeClaimQueueAdd).toHaveBeenCalledTimes(2);
    expect(mockBridgeClaimQueueAdd).toHaveBeenCalledWith("bridgeClaim", {
      bridgedTicketId: "bt-1",
      toAddress: "0xfan_wallet",
    });
    expect(mockBridgeClaimQueueAdd).toHaveBeenCalledWith("bridgeClaim", {
      bridgedTicketId: "bt-2",
      toAddress: "0xfan_wallet",
    });
  });

  it("filters by event_id when provided", async () => {
    mockPrisma.bridgedTicket.updateMany.mockResolvedValue({ count: 0 });

    const res = await app.inject({
      method: "POST",
      url: "/v1/bridge/claim",
      payload: { event_id: EVENT_ID },
      headers: { authorization: `Bearer ${fanToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(mockPrisma.bridgedTicket.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        ownerEmail: "test@example.com",
        status: "MINTED",
        eventId: EVENT_ID,
      }),
      data: { status: "CLAIMING" },
    });
  });
});

// ── Status tests ──────────────────────────────────────────────────────

describe("GET /v1/bridge/status/:id", () => {
  it("returns 400 when ID is not a valid UUID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/bridge/status/not-a-uuid",
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when bridged ticket not found", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: `/v1/bridge/status/${BRIDGED_TICKET_ID}`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when user does not own the bridged ticket", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: BRIDGED_TICKET_ID,
      ownerEmail: "other@example.com",
      claimedByAddress: "0xother",
      status: "MINTED",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/bridge/status/${BRIDGED_TICKET_ID}`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns bridged ticket status details when user is owner", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: BRIDGED_TICKET_ID,
      externalTicketId: "EVT-12345",
      ownerEmail: "test@example.com",
      status: "MINTED",
      tokenId: "1",
      eventId: EVENT_ID,
      passType: "VIP",
      mintTxHash: "0xmint123",
      claimTxHash: null,
      claimedByAddress: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/bridge/status/${BRIDGED_TICKET_ID}`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("MINTED");
    expect(body.mintTxHash).toBe("0xmint123");
    // Verify limited fields — no externalTicketId or ownerEmail returned
    expect(body.externalTicketId).toBeUndefined();
    expect(body.ownerEmail).toBeUndefined();
  });
});

// ── List tickets tests ────────────────────────────────────────────────

describe("GET /v1/bridge/tickets", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/bridge/tickets",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns bridged tickets for the authenticated user", async () => {
    mockPrisma.bridgedTicket.findMany.mockResolvedValue([
      {
        id: BRIDGED_TICKET_ID,
        externalTicketId: "EVT-12345",
        externalProvider: "generic",
        status: "CLAIMED",
        tokenId: "1",
        passType: "VIP",
        ownerEmail: "buyer@example.com",
        mintTxHash: "0xmint",
        claimTxHash: "0xclaim",
        createdAt: "2026-01-01T00:00:00.000Z",
        event: { id: EVENT_ID, name: "Concert", eventDate: "2026-12-01" },
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/bridge/tickets",
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tickets).toHaveLength(1);
    expect(res.json().total).toBe(1);
  });
});
