import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { makeToken } from "../../../__tests__/helpers";

// Mock Redis
const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    incr: vi.fn() as ReturnType<typeof vi.fn>,
    expire: vi.fn() as ReturnType<typeof vi.fn>,
    get: vi.fn() as ReturnType<typeof vi.fn>,
    set: vi.fn() as ReturnType<typeof vi.fn>,
    del: vi.fn() as ReturnType<typeof vi.fn>,
    ping: vi.fn() as ReturnType<typeof vi.fn>,
    quit: vi.fn() as ReturnType<typeof vi.fn>,
  },
}));

vi.mock("../../../db/redis", () => ({
  redis: mockRedis,
}));

// Mock logger
vi.mock("../../../config/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock global fetch
const mockFetch = vi.fn() as ReturnType<typeof vi.fn>;
vi.stubGlobal("fetch", mockFetch);

import { paymasterRoutes } from "../paymaster";

let app: FastifyInstance;
const token = makeToken();

beforeAll(async () => {
  app = Fastify();
  await app.register(paymasterRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRedis.incr.mockResolvedValue(1);
  mockRedis.expire.mockResolvedValue(1);
});

describe("POST /v1/paymaster", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/paymaster",
      payload: { test: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it("proxies request to AVNU paymaster", async () => {
    const avnuResponse = { jsonrpc: "2.0", result: { gas: "0x100" } };
    mockFetch.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(avnuResponse),
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/paymaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { jsonrpc: "2.0", method: "paymaster_getGasPrice" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual(avnuResponse);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("enforces daily rate limit", async () => {
    mockRedis.incr.mockResolvedValue(21); // Over default limit of 20

    const res = await app.inject({
      method: "POST",
      url: "/v1/paymaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { test: true },
    });

    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.payload).error).toContain("limit");
  });

  it("sets TTL on first request of the day", async () => {
    mockRedis.incr.mockResolvedValue(1);
    mockFetch.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    });

    await app.inject({
      method: "POST",
      url: "/v1/paymaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { test: true },
    });

    expect(mockRedis.expire).toHaveBeenCalledOnce();
    expect(mockRedis.expire.mock.calls[0][1]).toBe(86400);
  });

  it("does not reset TTL on subsequent requests", async () => {
    mockRedis.incr.mockResolvedValue(5); // Not first request
    mockFetch.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true }),
    });

    await app.inject({
      method: "POST",
      url: "/v1/paymaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { test: true },
    });

    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  it("returns 502 when AVNU is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("fetch failed"));

    const res = await app.inject({
      method: "POST",
      url: "/v1/paymaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { test: true },
    });

    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.payload).error).toContain("unavailable");
  });

  it("forwards AVNU error status codes", async () => {
    mockFetch.mockResolvedValue({
      status: 400,
      json: () => Promise.resolve({ error: "bad request from AVNU" }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/paymaster",
      headers: { authorization: `Bearer ${token}` },
      payload: { invalid: true },
    });

    expect(res.statusCode).toBe(400);
  });
});
