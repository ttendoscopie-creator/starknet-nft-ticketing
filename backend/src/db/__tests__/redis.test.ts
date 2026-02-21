import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRedisInstance } = vi.hoisted(() => ({
  mockRedisInstance: {
    get: vi.fn(),
    set: vi.fn(),
    setnx: vi.fn(),
    expire: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock("ioredis", () => ({
  default: vi.fn(() => mockRedisInstance),
}));

import { getTicketCache, setTicketCache, markTicketUsedAtomic } from "../redis";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTicketCache", () => {
  it("returns parsed JSON when key exists in Redis", async () => {
    const data = { status: "AVAILABLE", ownerAddress: "0xabc", ownerName: "Alice" };
    mockRedisInstance.get.mockResolvedValue(JSON.stringify(data));

    const result = await getTicketCache("t1");
    expect(result).toEqual(data);
    expect(mockRedisInstance.get).toHaveBeenCalledWith("ticket:t1");
  });

  it("returns null when key does not exist", async () => {
    mockRedisInstance.get.mockResolvedValue(null);

    const result = await getTicketCache("t1");
    expect(result).toBeNull();
  });
});

describe("setTicketCache", () => {
  it("sets JSON-stringified data with 3600s TTL", async () => {
    const data = { status: "AVAILABLE", ownerAddress: "0xabc" };
    await setTicketCache("t1", data);

    expect(mockRedisInstance.set).toHaveBeenCalledWith(
      "ticket:t1",
      JSON.stringify(data),
      "EX",
      3600
    );
  });
});

describe("markTicketUsedAtomic", () => {
  it("returns true when SETNX returns 1 (first scan)", async () => {
    mockRedisInstance.setnx.mockResolvedValue(1);

    const result = await markTicketUsedAtomic("t1");
    expect(result).toBe(true);
    expect(mockRedisInstance.setnx).toHaveBeenCalledWith(
      "ticket_used:t1",
      expect.any(String)
    );
  });

  it("sets 86400s expiry after successful SETNX", async () => {
    mockRedisInstance.setnx.mockResolvedValue(1);

    await markTicketUsedAtomic("t1");
    expect(mockRedisInstance.expire).toHaveBeenCalledWith("ticket_used:t1", 86400);
  });

  it("returns false when SETNX returns 0 (double scan)", async () => {
    mockRedisInstance.setnx.mockResolvedValue(0);

    const result = await markTicketUsedAtomic("t1");
    expect(result).toBe(false);
  });

  it("does not call expire when SETNX returns 0", async () => {
    mockRedisInstance.setnx.mockResolvedValue(0);

    await markTicketUsedAtomic("t1");
    expect(mockRedisInstance.expire).not.toHaveBeenCalled();
  });
});
