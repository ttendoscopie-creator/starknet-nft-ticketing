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
  it("returns true when SET NX returns OK (first scan)", async () => {
    mockRedisInstance.set.mockResolvedValue("OK");

    const result = await markTicketUsedAtomic("t1");
    expect(result).toBe(true);
    expect(mockRedisInstance.set).toHaveBeenCalledWith(
      "ticket_used:t1",
      expect.any(String),
      "EX",
      604800,
      "NX"
    );
  });

  it("returns false when SET NX returns null (double scan)", async () => {
    mockRedisInstance.set.mockResolvedValue(null);

    const result = await markTicketUsedAtomic("t1");
    expect(result).toBe(false);
  });
});
