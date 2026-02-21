import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// Mock dependencies before importing the route module
const {
  mockGetTicketById,
  mockLogScan,
  mockUpdateTicketStatus,
  mockVerifyQRSignature,
  mockIsTimestampValid,
  mockGetTicketCache,
  mockMarkTicketUsedAtomic,
  mockQueueAdd,
} = vi.hoisted(() => ({
  mockGetTicketById: vi.fn(),
  mockLogScan: vi.fn(),
  mockUpdateTicketStatus: vi.fn(),
  mockVerifyQRSignature: vi.fn(),
  mockIsTimestampValid: vi.fn(),
  mockGetTicketCache: vi.fn(),
  mockMarkTicketUsedAtomic: vi.fn(),
  mockQueueAdd: vi.fn(),
}));

vi.mock("../../../services/ticket.service", () => ({
  getTicketById: (...args: any[]) => mockGetTicketById(...args),
  logScan: (...args: any[]) => mockLogScan(...args),
  updateTicketStatus: (...args: any[]) => mockUpdateTicketStatus(...args),
}));

vi.mock("../../../services/qr.service", () => ({
  verifyQRSignature: (...args: any[]) => mockVerifyQRSignature(...args),
  isTimestampValid: (...args: any[]) => mockIsTimestampValid(...args),
}));

vi.mock("../../../db/redis", () => ({
  getTicketCache: (...args: any[]) => mockGetTicketCache(...args),
  markTicketUsedAtomic: (...args: any[]) => mockMarkTicketUsedAtomic(...args),
  bullmqConnection: { host: "localhost", port: 6379 },
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(() => ({ add: mockQueueAdd })),
}));

import { scanRoutes } from "../scan";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(scanRoutes);
  await app.ready();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const validBody = {
  ticket_id: "550e8400-e29b-41d4-a716-446655440000",
  signature: "a".repeat(64),
  timestamp: Math.floor(Date.now() / 1000),
  gate_id: "gate-1",
};

describe("POST /v1/scan/validate", () => {
  it("returns 400 INVALID_REQUEST when body is empty", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/scan/validate", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toBe("INVALID_REQUEST");
  });

  it("returns 400 INVALID_REQUEST when ticket_id is not a UUID", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: { ...validBody, ticket_id: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toBe("INVALID_REQUEST");
  });

  it("returns QR_EXPIRED when timestamp is stale", async () => {
    mockIsTimestampValid.mockReturnValue(false);

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: validBody,
    });
    expect(res.json().reason).toBe("QR_EXPIRED");
    expect(res.json().valid).toBe(false);
  });

  it("returns INVALID_SIGNATURE when signature is wrong", async () => {
    mockIsTimestampValid.mockReturnValue(true);
    mockVerifyQRSignature.mockReturnValue(false);

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: validBody,
    });
    expect(res.json().reason).toBe("INVALID_SIGNATURE");
  });

  it("returns TICKET_NOT_FOUND when cache misses and DB returns null", async () => {
    mockIsTimestampValid.mockReturnValue(true);
    mockVerifyQRSignature.mockReturnValue(true);
    mockGetTicketCache.mockResolvedValue(null);
    mockGetTicketById.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: validBody,
    });
    expect(res.json().reason).toBe("TICKET_NOT_FOUND");
  });

  it("falls back to DB when cache returns null", async () => {
    mockIsTimestampValid.mockReturnValue(true);
    mockVerifyQRSignature.mockReturnValue(true);
    mockGetTicketCache.mockResolvedValue(null);
    mockGetTicketById.mockResolvedValue({
      id: validBody.ticket_id,
      status: "AVAILABLE",
      ownerAddress: "0xabc",
      ownerEmail: "alice@test.com",
    });
    mockMarkTicketUsedAtomic.mockResolvedValue(true);
    mockLogScan.mockResolvedValue({});
    mockUpdateTicketStatus.mockResolvedValue({});
    mockQueueAdd.mockResolvedValue({});

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: validBody,
    });
    expect(res.json().valid).toBe(true);
    expect(mockGetTicketById).toHaveBeenCalledWith(validBody.ticket_id);
  });

  it("returns ALREADY_USED when markTicketUsedAtomic returns false", async () => {
    mockIsTimestampValid.mockReturnValue(true);
    mockVerifyQRSignature.mockReturnValue(true);
    mockGetTicketCache.mockResolvedValue({
      status: "AVAILABLE",
      ownerAddress: "0xabc",
    });
    mockMarkTicketUsedAtomic.mockResolvedValue(false);

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: validBody,
    });
    expect(res.json().reason).toBe("ALREADY_USED");
  });

  it("returns valid:true on successful scan", async () => {
    mockIsTimestampValid.mockReturnValue(true);
    mockVerifyQRSignature.mockReturnValue(true);
    mockGetTicketCache.mockResolvedValue({
      status: "AVAILABLE",
      ownerAddress: "0xabc",
      ownerName: "Alice",
    });
    mockMarkTicketUsedAtomic.mockResolvedValue(true);
    mockLogScan.mockResolvedValue({});
    mockUpdateTicketStatus.mockResolvedValue({});
    mockQueueAdd.mockResolvedValue({});

    const res = await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: validBody,
    });
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.ticket_id).toBe(validBody.ticket_id);
    expect(body.owner_name).toBe("Alice");
  });

  it("queues markUsed job on successful scan", async () => {
    mockIsTimestampValid.mockReturnValue(true);
    mockVerifyQRSignature.mockReturnValue(true);
    mockGetTicketCache.mockResolvedValue({
      status: "AVAILABLE",
      ownerAddress: "0xabc",
    });
    mockMarkTicketUsedAtomic.mockResolvedValue(true);
    mockLogScan.mockResolvedValue({});
    mockUpdateTicketStatus.mockResolvedValue({});
    mockQueueAdd.mockResolvedValue({});

    await app.inject({
      method: "POST",
      url: "/v1/scan/validate",
      payload: validBody,
    });

    expect(mockQueueAdd).toHaveBeenCalledWith("markUsed", {
      ticketId: validBody.ticket_id,
    });
  });
});
