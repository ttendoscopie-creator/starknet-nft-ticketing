import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---

const {
  mockPrisma,
  mockMarkUsedBatch,
  mockRedisHset,
  mockRedisHlen,
  mockRedisHgetall,
  mockRedisHdel,
} = vi.hoisted(() => ({
  mockPrisma: {
    ticket: {
      findUnique: vi.fn(),
    },
    scanLog: {
      updateMany: vi.fn(),
    },
  },
  mockMarkUsedBatch: vi.fn(),
  mockRedisHset: vi.fn(),
  mockRedisHlen: vi.fn(),
  mockRedisHgetall: vi.fn(),
  mockRedisHdel: vi.fn(),
}));

vi.mock("../../db/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../services/starknet.service", () => ({
  markUsedBatch: (...args: any[]) => mockMarkUsedBatch(...args),
}));

vi.mock("../../db/redis", () => ({
  bullmqConnection: { host: "localhost", port: 6379 },
  redis: {
    hset: (...args: any[]) => mockRedisHset(...args),
    hlen: (...args: any[]) => mockRedisHlen(...args),
    hgetall: (...args: any[]) => mockRedisHgetall(...args),
    hdel: (...args: any[]) => mockRedisHdel(...args),
  },
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(() => ({ add: vi.fn() })),
  Worker: vi.fn(() => ({ on: vi.fn() })),
}));

vi.mock("../../config/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { Worker } from "bullmq";

// The module-level flushBatch() call at startup will run with empty hgetall
mockRedisHgetall.mockResolvedValue({});

await import("../markUsed.worker");

const workerCalls = (Worker as unknown as ReturnType<typeof vi.fn>).mock.calls;
const markUsedHandler = workerCalls.find((c: any[]) => c[0] === "markUsed")?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisHset.mockResolvedValue(1);
  mockRedisHlen.mockResolvedValue(1);
  mockRedisHgetall.mockResolvedValue({});
  mockRedisHdel.mockResolvedValue(1);
  mockMarkUsedBatch.mockResolvedValue("0xtx_batch");
  mockPrisma.scanLog.updateMany.mockResolvedValue({ count: 1 });
});

describe("markUsed worker", () => {
  const makeJob = (data: any) => ({ data, id: "test-job" });

  it("adds ticket to Redis batch", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({
      id: "ticket-1",
      tokenId: BigInt(42),
      event: { contractAddress: "0xcontract" },
    });
    mockRedisHlen.mockResolvedValue(1); // below BATCH_SIZE

    await markUsedHandler(makeJob({ ticketId: "ticket-1" }));

    expect(mockRedisHset).toHaveBeenCalledWith(
      "markUsed:pending",
      "ticket-1",
      JSON.stringify({ ticketId: "ticket-1", contractAddress: "0xcontract", tokenId: "42" })
    );
  });

  it("flushes batch when batch size reached", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({
      id: "ticket-50",
      tokenId: BigInt(50),
      event: { contractAddress: "0xcontract" },
    });
    mockRedisHlen.mockResolvedValue(50); // equals BATCH_SIZE
    mockRedisHgetall.mockResolvedValue({
      "ticket-50": JSON.stringify({ ticketId: "ticket-50", contractAddress: "0xcontract", tokenId: "50" }),
    });
    mockRedisHdel.mockResolvedValue(1);

    await markUsedHandler(makeJob({ ticketId: "ticket-50" }));

    expect(mockMarkUsedBatch).toHaveBeenCalledWith("0xcontract", [BigInt(50)]);
  });

  it("handles flush error by re-queuing to Redis", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({
      id: "ticket-1",
      tokenId: BigInt(7),
      event: { contractAddress: "0xcontract" },
    });
    mockRedisHlen.mockResolvedValue(50); // triggers flush
    mockRedisHgetall.mockResolvedValue({
      "ticket-1": JSON.stringify({ ticketId: "ticket-1", contractAddress: "0xcontract", tokenId: "7" }),
    });
    mockRedisHdel.mockResolvedValue(1);
    mockMarkUsedBatch.mockRejectedValue(new Error("RPC error"));

    await markUsedHandler(makeJob({ ticketId: "ticket-1" }));

    // After failure, entries are re-added to Redis
    expect(mockRedisHset).toHaveBeenCalledWith(
      "markUsed:pending",
      "0xcontract:7",
      JSON.stringify({ contractAddress: "0xcontract", tokenId: "7" })
    );
  });

  it("skips if ticket not found", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(null);

    await markUsedHandler(makeJob({ ticketId: "nonexistent" }));

    expect(mockRedisHset).not.toHaveBeenCalled();
    expect(mockMarkUsedBatch).not.toHaveBeenCalled();
  });

  it("updates scanLog syncStatus on successful flush", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({
      id: "ticket-1",
      tokenId: BigInt(10),
      event: { contractAddress: "0xcontract" },
    });
    mockRedisHlen.mockResolvedValue(50); // triggers flush
    mockRedisHgetall.mockResolvedValue({
      "ticket-1": JSON.stringify({ ticketId: "ticket-1", contractAddress: "0xcontract", tokenId: "10" }),
    });
    mockRedisHdel.mockResolvedValue(1);
    mockMarkUsedBatch.mockResolvedValue("0xtx_sync");

    await markUsedHandler(makeJob({ ticketId: "ticket-1" }));

    expect(mockPrisma.scanLog.updateMany).toHaveBeenCalledWith({
      where: {
        ticket: {
          event: { contractAddress: "0xcontract" },
          tokenId: { in: [BigInt(10)] },
        },
        syncStatus: "PENDING",
      },
      data: { syncStatus: "SYNCED" },
    });
  });
});
