import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { makeToken } from "../../../__tests__/helpers";

// Mock ticket service
const mockGetTicketsByOwner = vi.fn();
const mockGetTicketsByEvent = vi.fn();
const mockGetTicketById = vi.fn();

vi.mock("../../../services/ticket.service", () => ({
  getTicketsByOwner: (...args: any[]) => mockGetTicketsByOwner(...args),
  getTicketsByEvent: (...args: any[]) => mockGetTicketsByEvent(...args),
  getTicketById: (...args: any[]) => mockGetTicketById(...args),
}));

// Mock QR service
const mockGenerateQRPayload = vi.fn();
const mockGenerateQRDataUrl = vi.fn();

vi.mock("../../../services/qr.service", () => ({
  generateQRPayload: (...args: any[]) => mockGenerateQRPayload(...args),
  generateQRDataUrl: (...args: any[]) => mockGenerateQRDataUrl(...args),
}));

import { ticketRoutes } from "../tickets";

const TICKET_ID = "550e8400-e29b-41d4-a716-446655440000";
const EVENT_ID = "660e8400-e29b-41d4-a716-446655440000";

let app: FastifyInstance;
const fanToken = makeToken({ userId: "u1", walletAddress: "0xfan", role: "fan" });

beforeAll(async () => {
  app = Fastify();
  await app.register(ticketRoutes);
  await app.ready();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /v1/tickets", () => {
  it("returns 401 without auth token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/tickets" });
    expect(res.statusCode).toBe(401);
  });

  it("returns tickets for the authenticated user", async () => {
    mockGetTicketsByOwner.mockResolvedValue([
      { id: TICKET_ID, tokenId: "1", status: "AVAILABLE" },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/tickets",
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(mockGetTicketsByOwner).toHaveBeenCalledWith("0xfan");
  });
});

describe("GET /v1/tickets/:id", () => {
  it("returns 400 when ID is not a valid UUID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/tickets/nonexistent",
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when ticket does not exist", async () => {
    mockGetTicketById.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets/${TICKET_ID}`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns ticket with event included", async () => {
    mockGetTicketById.mockResolvedValue({
      id: TICKET_ID,
      status: "AVAILABLE",
      event: { name: "Concert" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets/${TICKET_ID}`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().event.name).toBe("Concert");
  });
});

describe("GET /v1/events/:eventId/tickets", () => {
  it("returns 400 when eventId is not a valid UUID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/events/not-a-uuid/tickets",
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns tickets for the given event", async () => {
    mockGetTicketsByEvent.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);

    const res = await app.inject({
      method: "GET",
      url: `/v1/events/${EVENT_ID}/tickets`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
    expect(mockGetTicketsByEvent).toHaveBeenCalledWith(EVENT_ID);
  });
});

describe("GET /v1/tickets/:id/qr", () => {
  it("returns 404 when ticket not found", async () => {
    mockGetTicketById.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets/${TICKET_ID}/qr`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when user is not the ticket owner", async () => {
    mockGetTicketById.mockResolvedValue({
      id: TICKET_ID,
      ownerAddress: "0xother",
      status: "AVAILABLE",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets/${TICKET_ID}/qr`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 when ticket status is USED", async () => {
    mockGetTicketById.mockResolvedValue({
      id: TICKET_ID,
      ownerAddress: "0xfan",
      status: "USED",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets/${TICKET_ID}/qr`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns QR payload for valid owner with AVAILABLE ticket", async () => {
    mockGetTicketById.mockResolvedValue({
      id: TICKET_ID,
      ownerAddress: "0xfan",
      status: "AVAILABLE",
    });
    mockGenerateQRPayload.mockReturnValue({
      ticket_id: TICKET_ID,
      timestamp: 123,
      signature: "abc",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets/${TICKET_ID}/qr`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket_id).toBe(TICKET_ID);
  });
});

describe("GET /v1/tickets/:id/qr-image", () => {
  it("returns 404 when ticket not found", async () => {
    mockGetTicketById.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets/${TICKET_ID}/qr-image`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when user is not the ticket owner", async () => {
    mockGetTicketById.mockResolvedValue({
      id: TICKET_ID,
      ownerAddress: "0xother",
      status: "AVAILABLE",
    });

    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets/${TICKET_ID}/qr-image`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns data URL for valid owner", async () => {
    mockGetTicketById.mockResolvedValue({
      id: TICKET_ID,
      ownerAddress: "0xfan",
      status: "AVAILABLE",
    });
    mockGenerateQRDataUrl.mockResolvedValue("data:image/png;base64,abc");

    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets/${TICKET_ID}/qr-image`,
      headers: { authorization: `Bearer ${fanToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().qr).toBe("data:image/png;base64,abc");
  });
});
