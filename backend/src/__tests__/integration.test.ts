import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";

// ── Hoisted mocks ──────────────────────────────────────────────────────

const {
  mockPrisma,
  mockDeployEventContract,
  mockMintTicket,
  mockVerifyQRSignature,
  mockIsTimestampValid,
  mockGetTicketCache,
  mockMarkTicketUsedAtomic,
  mockSetTicketCache,
  mockQueueAdd,
  mockConstructEvent,
} = vi.hoisted(() => ({
  mockPrisma: {
    organizer: { findFirst: vi.fn() },
    event: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    ticket: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    pendingMint: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    listing: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    scanLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  mockDeployEventContract: vi.fn(),
  mockMintTicket: vi.fn(),
  mockVerifyQRSignature: vi.fn(),
  mockIsTimestampValid: vi.fn(),
  mockGetTicketCache: vi.fn(),
  mockMarkTicketUsedAtomic: vi.fn(),
  mockSetTicketCache: vi.fn(),
  mockQueueAdd: vi.fn(),
  mockConstructEvent: vi.fn(),
}));

// Set env before imports
vi.hoisted(() => {
  process.env.MARKETPLACE_ADDRESS = "0xmarketplace";
  process.env.FACTORY_ADDRESS = "0xfactory";
  process.env.FRONTEND_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
});

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

vi.mock("../services/starknet.service", () => ({
  deployEventContract: (...args: any[]) => mockDeployEventContract(...args),
  mintTicket: (...args: any[]) => mockMintTicket(...args),
  verifyERC20Transfer: vi.fn(),
}));

vi.mock("../services/qr.service", () => ({
  verifyQRSignature: (...args: any[]) => mockVerifyQRSignature(...args),
  isTimestampValid: (...args: any[]) => mockIsTimestampValid(...args),
  generateQRPayload: vi.fn(),
}));

const { mockLogScan, mockUpdateTicketStatus, mockGetTicketById } = vi.hoisted(() => ({
  mockLogScan: vi.fn(),
  mockUpdateTicketStatus: vi.fn(),
  mockGetTicketById: vi.fn(),
}));

vi.mock("../services/ticket.service", () => ({
  getTicketById: (...args: any[]) => mockGetTicketById(...args),
  logScan: (...args: any[]) => mockLogScan(...args),
  updateTicketStatus: (...args: any[]) => mockUpdateTicketStatus(...args),
}));

vi.mock("../db/redis", () => ({
  getTicketCache: (...args: any[]) => mockGetTicketCache(...args),
  markTicketUsedAtomic: (...args: any[]) => mockMarkTicketUsedAtomic(...args),
  setTicketCache: (...args: any[]) => mockSetTicketCache(...args),
  bullmqConnection: { host: "localhost", port: 6379 },
  redis: { ping: vi.fn().mockResolvedValue("PONG"), get: vi.fn(), set: vi.fn() },
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(() => ({ add: mockQueueAdd })),
  Worker: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: vi.fn(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  })),
}));

vi.mock("../config/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("@fastify/rate-limit", () => ({
  default: vi.fn(async () => {}),
}));

import { buildApp } from "../api/server";

// ── Test data ──────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET!;

function makeToken(role: "fan" | "organizer" | "staff", overrides: Record<string, string> = {}) {
  return jwt.sign(
    { userId: "user-1", walletAddress: "0xbuyer_wallet", role, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

const organizerToken = makeToken("organizer", { userId: "org-1" });
const staffToken = makeToken("staff", { userId: "staff-1" });

// ── Integration test ───────────────────────────────────────────────────

describe("Integration: Event → Mint → Scan → Mark Used", () => {
  let app: FastifyInstance;

  // Track state across the lifecycle
  const state = {
    eventId: "evt-1",
    contractAddress: "0xdeployed_event_contract",
    ticketId: "550e8400-e29b-41d4-a716-446655440000",
    tokenId: BigInt(1),
    pendingMintId: "pm-1",
    paymentIntent: "pi_integration_test",
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // These are called with .catch() in scan.ts, so they must return Promises
    mockLogScan.mockResolvedValue({});
    mockUpdateTicketStatus.mockResolvedValue({});
    mockGetTicketById.mockResolvedValue(null);
  });

  // ── Step 1: Organizer creates an event ──

  it("Step 1: organizer creates an event (deploys contract on-chain)", async () => {
    mockPrisma.organizer.findFirst.mockResolvedValue({ id: "org-1", name: "Test Org" });
    mockDeployEventContract.mockResolvedValue(state.contractAddress);
    mockPrisma.event.create.mockResolvedValue({
      id: state.eventId,
      name: "Integration Concert",
      contractAddress: state.contractAddress,
      maxSupply: 100,
      acceptedCurrencies: ["STRK"],
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: {
        name: "Integration Concert",
        eventDate: "2026-12-01T20:00:00.000Z",
        maxSupply: 100,
      },
      headers: { authorization: `Bearer ${organizerToken}` },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().contractAddress).toBe(state.contractAddress);
    expect(mockDeployEventContract).toHaveBeenCalledWith(
      expect.objectContaining({ maxSupply: 100 })
    );
  });

  // ── Step 2: Stripe webhook triggers mint queue ──

  it("Step 2: Stripe webhook queues a mint job after payment", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_integration",
          payment_intent: state.paymentIntent,
          metadata: {
            event_id: state.eventId,
            buyer_email: "fan@integration.com",
            buyer_wallet_address: "0xbuyer_wallet",
          },
        },
      },
    });
    mockPrisma.pendingMint.findUnique.mockResolvedValue(null); // not a duplicate
    mockPrisma.pendingMint.create.mockResolvedValue({
      id: state.pendingMintId,
      eventId: state.eventId,
      buyerEmail: "fan@integration.com",
      status: "PENDING",
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
          eventId: state.eventId,
          buyerEmail: "fan@integration.com",
          stripePaymentIntentId: state.paymentIntent,
          status: "PENDING",
        }),
      })
    );
    expect(mockQueueAdd).toHaveBeenCalledWith("mint", {
      pendingMintId: state.pendingMintId,
      eventId: state.eventId,
      buyerEmail: "fan@integration.com",
      buyerWalletAddress: "0xbuyer_wallet",
    });
  });

  // ── Step 3: Verify ticket is retrievable ──

  it("Step 3: fan retrieves event details with ticket count", async () => {
    mockPrisma.event.findUnique.mockResolvedValue({
      id: state.eventId,
      name: "Integration Concert",
      contractAddress: state.contractAddress,
      organizer: { name: "Test Org" },
      _count: { tickets: 1 },
    });

    const fanToken = makeToken("fan");
    const res = await app.inject({
      method: "GET",
      url: `/v1/events/${state.eventId}`,
      headers: { authorization: `Bearer ${fanToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()._count.tickets).toBe(1);
    expect(res.json().contractAddress).toBe(state.contractAddress);
  });

  // ── Step 4: Staff scans ticket at the gate ──

  it("Step 4: staff scans QR code and validates ticket", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = "a".repeat(64);

    mockIsTimestampValid.mockReturnValue(true);
    mockVerifyQRSignature.mockReturnValue(true);
    mockGetTicketCache.mockResolvedValue({
      status: "AVAILABLE",
      ownerAddress: "0xbuyer_wallet",
      ownerName: "fan@integration.com",
    });
    mockMarkTicketUsedAtomic.mockResolvedValue(true);
    mockQueueAdd.mockResolvedValue({});

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: {
        ticket_id: state.ticketId,
        signature,
        timestamp,
        gate_id: "gate-main",
      },
      headers: { authorization: `Bearer ${staffToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.ticket_id).toBe(state.ticketId);
    expect(body.owner_name).toBe("fan@integration.com");

    // Verify markUsed was queued for on-chain sync
    expect(mockQueueAdd).toHaveBeenCalledWith("markUsed", {
      ticketId: state.ticketId,
    });
  });

  // ── Step 5: Double-scan is rejected ──

  it("Step 5: re-scanning the same ticket returns ALREADY_USED", async () => {
    mockIsTimestampValid.mockReturnValue(true);
    mockVerifyQRSignature.mockReturnValue(true);
    mockGetTicketCache.mockResolvedValue({
      status: "USED",
      ownerAddress: "0xbuyer_wallet",
    });
    mockMarkTicketUsedAtomic.mockResolvedValue(false); // already claimed

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: {
        ticket_id: state.ticketId,
        signature: "a".repeat(64),
        timestamp: Math.floor(Date.now() / 1000),
      },
      headers: { authorization: `Bearer ${staffToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
    expect(res.json().reason).toBe("ALREADY_USED");
  });

  // ── Step 6: Duplicate webhook is idempotent ──

  it("Step 6: duplicate Stripe webhook is idempotent", async () => {
    mockConstructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_integration",
          payment_intent: state.paymentIntent,
          metadata: {
            event_id: state.eventId,
            buyer_email: "fan@integration.com",
            buyer_wallet_address: "0xbuyer_wallet",
          },
        },
      },
    });
    mockPrisma.pendingMint.findUnique.mockResolvedValue({
      id: state.pendingMintId,
      status: "MINTED",
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
    expect(mockPrisma.pendingMint.create).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  // ── Step 7: Marketplace listing flow ──

  it("Step 7: marketplace lists available tickets", async () => {
    mockPrisma.listing.findMany.mockResolvedValue([
      {
        id: "listing-1",
        price: "150",
        isActive: true,
        ticket: {
          id: state.ticketId,
          event: { name: "Integration Concert", eventDate: "2026-12-01T20:00:00.000Z" },
        },
      },
    ]);
    mockPrisma.listing.count.mockResolvedValue(1);

    const res = await app.inject({
      method: "GET",
      url: "/v1/marketplace/listings",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.listings).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.skip).toBe(0);
    expect(body.take).toBe(20);
  });
});
