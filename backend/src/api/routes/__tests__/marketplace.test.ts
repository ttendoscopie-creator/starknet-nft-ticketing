import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { makeToken } from "../../../__tests__/helpers";

// Mock Prisma
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    listing: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    ticket: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../../db/prisma", () => ({
  prisma: mockPrisma,
}));

import { marketplaceRoutes } from "../marketplace";

let app: FastifyInstance;
const fanToken = makeToken({ userId: "u1", walletAddress: "0xfan", role: "fan" });

beforeAll(async () => {
  app = Fastify();
  await app.register(marketplaceRoutes);
  await app.ready();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /v1/marketplace/listings", () => {
  it("returns paginated active listings without auth (public)", async () => {
    mockPrisma.listing.findMany.mockResolvedValue([
      { id: "l1", price: "100", isActive: true },
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

  it("respects skip and take query params", async () => {
    mockPrisma.listing.findMany.mockResolvedValue([]);
    mockPrisma.listing.count.mockResolvedValue(50);

    const res = await app.inject({
      method: "GET",
      url: "/v1/marketplace/listings?skip=10&take=5",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skip).toBe(10);
    expect(body.take).toBe(5);
    expect(body.total).toBe(50);
  });
});

describe("POST /v1/marketplace/listings", () => {
  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/marketplace/listings",
      payload: { ticketId: "550e8400-e29b-41d4-a716-446655440000", price: 100 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when price is zero", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/marketplace/listings",
      payload: { ticketId: "550e8400-e29b-41d4-a716-446655440000", price: 0 },
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when ticket not found", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/v1/marketplace/listings",
      payload: { ticketId: "550e8400-e29b-41d4-a716-446655440000", price: 100 },
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when user is not the ticket owner", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({
      id: "t1",
      ownerAddress: "0xother",
      status: "AVAILABLE",
      transferCount: 0,
      event: { isSoulbound: false, maxTransfers: 0 },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/marketplace/listings",
      payload: { ticketId: "550e8400-e29b-41d4-a716-446655440000", price: 100 },
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 when ticket status is not AVAILABLE", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({
      id: "t1",
      ownerAddress: "0xfan",
      status: "USED",
      transferCount: 0,
      event: { isSoulbound: false, maxTransfers: 0 },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/marketplace/listings",
      payload: { ticketId: "550e8400-e29b-41d4-a716-446655440000", price: 100 },
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when ticket is soulbound", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({
      id: "t1",
      ownerAddress: "0xfan",
      status: "AVAILABLE",
      transferCount: 0,
      event: { isSoulbound: true, maxTransfers: 0 },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/marketplace/listings",
      payload: { ticketId: "550e8400-e29b-41d4-a716-446655440000", price: 100 },
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Soulbound tickets cannot be listed");
  });

  it("returns 400 when transfer limit reached", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({
      id: "t1",
      ownerAddress: "0xfan",
      status: "AVAILABLE",
      transferCount: 2,
      event: { isSoulbound: false, maxTransfers: 2 },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/marketplace/listings",
      payload: { ticketId: "550e8400-e29b-41d4-a716-446655440000", price: 100 },
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Maximum transfer limit reached");
  });

  it("returns 409 when ticket is no longer available (race condition)", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({
      id: "t1",
      ownerAddress: "0xfan",
      status: "AVAILABLE",
      transferCount: 0,
      event: { isSoulbound: false, maxTransfers: 0 },
    });
    mockPrisma.$transaction.mockRejectedValue(new Error("TICKET_NOT_AVAILABLE"));

    const res = await app.inject({
      method: "POST",
      url: "/v1/marketplace/listings",
      payload: { ticketId: "550e8400-e29b-41d4-a716-446655440000", price: 100 },
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("Ticket is no longer available");
  });

  it("returns 201 and creates listing via transaction", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({
      id: "t1",
      ownerAddress: "0xfan",
      status: "AVAILABLE",
      transferCount: 0,
      event: { isSoulbound: false, maxTransfers: 0 },
    });
    // Interactive transaction: mock calls the callback with a tx proxy
    mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
      const txProxy = {
        ticket: {
          findUnique: vi.fn().mockResolvedValue({ id: "t1", status: "AVAILABLE" }),
          update: vi.fn().mockResolvedValue({ id: "t1", status: "LISTED" }),
        },
        listing: {
          create: vi.fn().mockResolvedValue({
            id: "l1",
            ticketId: "t1",
            sellerAddress: "0xfan",
            price: 100,
          }),
        },
      };
      return fn(txProxy);
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/marketplace/listings",
      payload: { ticketId: "550e8400-e29b-41d4-a716-446655440000", price: 100 },
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(201);
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });
});

describe("DELETE /v1/marketplace/listings/:id", () => {
  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/marketplace/listings/550e8400-e29b-41d4-a716-446655440001",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 when listing not found", async () => {
    mockPrisma.listing.findUnique.mockResolvedValue(null);

    const res = await app.inject({
      method: "DELETE",
      url: "/v1/marketplace/listings/550e8400-e29b-41d4-a716-446655440001",
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when user is not the seller", async () => {
    mockPrisma.listing.findUnique.mockResolvedValue({
      id: "l1",
      sellerAddress: "0xother",
      isActive: true,
      ticket: { id: "t1" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: "/v1/marketplace/listings/550e8400-e29b-41d4-a716-446655440001",
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 when listing is already inactive", async () => {
    mockPrisma.listing.findUnique.mockResolvedValue({
      id: "l1",
      sellerAddress: "0xfan",
      isActive: false,
      ticket: { id: "t1" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: "/v1/marketplace/listings/550e8400-e29b-41d4-a716-446655440001",
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns success and restores ticket to AVAILABLE", async () => {
    mockPrisma.listing.findUnique.mockResolvedValue({
      id: "l1",
      sellerAddress: "0xfan",
      isActive: true,
      ticketId: "t1",
      ticket: { id: "t1" },
    });
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);

    const res = await app.inject({
      method: "DELETE",
      url: "/v1/marketplace/listings/550e8400-e29b-41d4-a716-446655440001",
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });
});
