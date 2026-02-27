import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { makeToken, makeOrganizerToken } from "../../../__tests__/helpers";

// Mock Prisma
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    event: { findUnique: vi.fn() },
    pendingMint: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mockPrisma),
}));

// Mock starknet service
const { mockVerifyERC20Transfer } = vi.hoisted(() => ({
  mockVerifyERC20Transfer: vi.fn(),
}));

vi.mock("../../../services/starknet.service", () => ({
  verifyERC20Transfer: mockVerifyERC20Transfer,
}));

import { paymentRoutes } from "../payments";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(paymentRoutes);
  await app.ready();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const validPayment = {
  eventId: "550e8400-e29b-41d4-a716-446655440000",
  txHash: "0x034ba56f92265f0868c57d3fe72ecab144fc96f97954bbbc4252cef8e8a979ba",
  buyerWalletAddress: "0x034ba56f92265f0868c57d3fe72ecab144fc96f97954bbbc4252cef8e8a979ba",
  currency: "USDC",
};

const mockEvent = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  contractAddress: "0xcontract",
  primaryPrice: BigInt(1000000),
  acceptedCurrencies: ["STRK", "USDC"],
};

describe("POST /v1/payments/verify-crypto", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/verify-crypto",
      payload: validPayment,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when txHash is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/verify-crypto",
      payload: { ...validPayment, txHash: undefined },
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid currency", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/verify-crypto",
      payload: { ...validPayment, currency: "BTC" },
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when event does not accept currency", async () => {
    mockPrisma.pendingMint.findFirst.mockResolvedValue(null);
    mockPrisma.event.findUnique.mockResolvedValue({
      ...mockEvent,
      acceptedCurrencies: ["STRK"],
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/verify-crypto",
      payload: validPayment, // currency=USDC
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("does not accept USDC");
  });

  it("returns 400 when tx verification fails", async () => {
    mockPrisma.pendingMint.findFirst.mockResolvedValue(null);
    mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
    mockVerifyERC20Transfer.mockResolvedValue(false);

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/verify-crypto",
      payload: validPayment,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Transaction verification failed");
  });

  it("returns 409 when tx hash already used", async () => {
    mockPrisma.pendingMint.findFirst.mockResolvedValue({
      id: "existing-mint",
      cryptoTxHash: validPayment.txHash,
    });
    mockPrisma.event.findUnique.mockResolvedValue(mockEvent);

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/verify-crypto",
      payload: validPayment,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("Transaction already used for a previous payment");
  });

  it("returns 201 on successful USDC verification", async () => {
    mockPrisma.pendingMint.findFirst.mockResolvedValue(null);
    mockPrisma.event.findUnique.mockResolvedValue(mockEvent);
    mockVerifyERC20Transfer.mockResolvedValue(true);
    mockPrisma.pendingMint.create.mockResolvedValue({
      id: "mint-1",
      status: "PENDING",
      cryptoTxHash: validPayment.txHash,
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/verify-crypto",
      payload: validPayment,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().cryptoTxHash).toBe(validPayment.txHash);
    expect(res.json().currency).toBe("USDC");
    expect(mockVerifyERC20Transfer).toHaveBeenCalledWith(
      validPayment.txHash,
      "0xcontract",
      BigInt(1000000),
      expect.stringContaining("0x053b40a647"),
    );
  });
});
