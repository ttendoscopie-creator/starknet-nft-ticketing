import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { makeOrganizerToken, makeToken } from "../../../__tests__/helpers";

// Set env vars before module imports
vi.hoisted(() => {
  process.env.MARKETPLACE_ADDRESS = "0x1234567890abcdef";
});

// Mock Prisma
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    organizer: { findFirst: vi.fn() },
    event: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("../../../db/prisma", () => ({
  prisma: mockPrisma,
}));

// Mock starknet service
const { mockDeployEventContract } = vi.hoisted(() => ({
  mockDeployEventContract: vi.fn(),
}));

vi.mock("../../../services/starknet.service", () => ({
  deployEventContract: (...args: any[]) => mockDeployEventContract(...args),
}));

// Mock logger
vi.mock("../../../config/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { eventRoutes } from "../events";

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(eventRoutes);
  await app.ready();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const validEvent = {
  name: "Concert Paris",
  eventDate: "2025-12-01T20:00:00.000Z",
  maxSupply: 1000,
};

describe("POST /v1/events", () => {
  it("returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: validEvent,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when user role is fan", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: validEvent,
      headers: { authorization: `Bearer ${makeToken({ role: "fan" })}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 when name is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: { ...validEvent, name: "" },
      headers: { authorization: `Bearer ${makeOrganizerToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when organizer not found in DB", async () => {
    mockPrisma.organizer.findFirst.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: validEvent,
      headers: { authorization: `Bearer ${makeOrganizerToken()}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 201 with created event on valid input", async () => {
    mockPrisma.organizer.findFirst.mockResolvedValue({ id: "org-1", name: "Org" });
    mockDeployEventContract.mockResolvedValue("0xdeployed_contract");
    mockPrisma.event.create.mockResolvedValue({
      id: "e1",
      name: "Concert Paris",
      contractAddress: "0xdeployed_contract",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: validEvent,
      headers: { authorization: `Bearer ${makeOrganizerToken()}` },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().contractAddress).toBe("0xdeployed_contract");
    expect(mockDeployEventContract).toHaveBeenCalled();
  });

  it("returns 500 when on-chain deployment fails", async () => {
    mockPrisma.organizer.findFirst.mockResolvedValue({ id: "org-1", name: "Org" });
    mockDeployEventContract.mockRejectedValue(new Error("RPC timeout"));

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: validEvent,
      headers: { authorization: `Bearer ${makeOrganizerToken()}` },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("On-chain contract deployment failed");
    expect(mockPrisma.event.create).not.toHaveBeenCalled();
  });
});

describe("GET /v1/events", () => {
  it("returns paginated list of events", async () => {
    mockPrisma.event.findMany.mockResolvedValue([
      { id: "e1", name: "Event 1" },
      { id: "e2", name: "Event 2" },
    ]);
    mockPrisma.event.count.mockResolvedValue(2);

    const token = makeOrganizerToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toHaveLength(2);
    expect(res.json().total).toBe(2);
    expect(res.json().skip).toBe(0);
    expect(res.json().take).toBe(20);
  });
});

describe("POST /v1/events — acceptedCurrencies", () => {
  it("returns 201 with custom acceptedCurrencies", async () => {
    mockPrisma.organizer.findFirst.mockResolvedValue({ id: "org-1", name: "Org" });
    mockDeployEventContract.mockResolvedValue("0xdeployed_contract");
    mockPrisma.event.create.mockResolvedValue({
      id: "e2",
      name: "Crypto Concert",
      contractAddress: "0xdeployed_contract",
      acceptedCurrencies: ["STRK", "USDC"],
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: { ...validEvent, acceptedCurrencies: ["STRK", "USDC"] },
      headers: { authorization: `Bearer ${makeOrganizerToken()}` },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().acceptedCurrencies).toEqual(["STRK", "USDC"]);
  });

  it("returns 400 with invalid currency", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: { ...validEvent, acceptedCurrencies: ["BTC"] },
      headers: { authorization: `Bearer ${makeOrganizerToken()}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/events/:id", () => {
  const validEventId = "550e8400-e29b-41d4-a716-446655440000";

  it("returns 400 when ID is not a valid UUID", async () => {
    const token = makeOrganizerToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/events/nonexistent",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when event does not exist", async () => {
    mockPrisma.event.findUnique.mockResolvedValue(null);

    const token = makeOrganizerToken();
    const res = await app.inject({
      method: "GET",
      url: `/v1/events/${validEventId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns event with organizer name and ticket count", async () => {
    mockPrisma.event.findUnique.mockResolvedValue({
      id: validEventId,
      name: "Concert",
      organizer: { name: "Org" },
      _count: { tickets: 42 },
    });

    const token = makeOrganizerToken();
    const res = await app.inject({
      method: "GET",
      url: `/v1/events/${validEventId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().organizer.name).toBe("Org");
    expect(res.json()._count.tickets).toBe(42);
  });
});
