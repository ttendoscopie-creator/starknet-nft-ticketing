import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { makeOrganizerToken, makeToken } from "../../../__tests__/helpers";

// Mock Prisma
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    organizer: { findFirst: vi.fn() },
    event: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mockPrisma),
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
    mockPrisma.event.create.mockResolvedValue({
      id: "e1",
      name: "Concert Paris",
      contractAddress: "0x0",
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      payload: validEvent,
      headers: { authorization: `Bearer ${makeOrganizerToken()}` },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().contractAddress).toBe("0x0");
  });
});

describe("GET /v1/events", () => {
  it("returns list of events", async () => {
    mockPrisma.event.findMany.mockResolvedValue([
      { id: "e1", name: "Event 1" },
      { id: "e2", name: "Event 2" },
    ]);

    const token = makeOrganizerToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/events",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });
});

describe("GET /v1/events/:id", () => {
  it("returns 404 when event does not exist", async () => {
    mockPrisma.event.findUnique.mockResolvedValue(null);

    const token = makeOrganizerToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/events/nonexistent",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns event with organizer name and ticket count", async () => {
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "e1",
      name: "Concert",
      organizer: { name: "Org" },
      _count: { tickets: 42 },
    });

    const token = makeOrganizerToken();
    const res = await app.inject({
      method: "GET",
      url: "/v1/events/e1",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().organizer.name).toBe("Org");
    expect(res.json()._count.tickets).toBe(42);
  });
});
