import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    ticket: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    scanLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mockPrisma),
  TicketStatus: {
    AVAILABLE: "AVAILABLE",
    LISTED: "LISTED",
    USED: "USED",
    CANCELLED: "CANCELLED",
  },
}));

import {
  createTicket,
  getTicketById,
  getTicketByTokenId,
  updateTicketStatus,
  getTicketsByOwner,
  getTicketsByEvent,
  logScan,
} from "../ticket.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createTicket", () => {
  it("calls prisma.ticket.create with correct data", async () => {
    mockPrisma.ticket.create.mockResolvedValue({ id: "t1" });
    await createTicket({
      eventId: "e1",
      tokenId: 1n,
      ownerAddress: "0xabc",
      ownerEmail: "a@b.com",
    });
    expect(mockPrisma.ticket.create).toHaveBeenCalledWith({
      data: {
        eventId: "e1",
        tokenId: 1n,
        ownerAddress: "0xabc",
        ownerEmail: "a@b.com",
      },
    });
  });

  it("passes ownerEmail as undefined when not provided", async () => {
    mockPrisma.ticket.create.mockResolvedValue({ id: "t1" });
    await createTicket({ eventId: "e1", tokenId: 1n, ownerAddress: "0xabc" });
    expect(mockPrisma.ticket.create).toHaveBeenCalledWith({
      data: {
        eventId: "e1",
        tokenId: 1n,
        ownerAddress: "0xabc",
        ownerEmail: undefined,
      },
    });
  });
});

describe("getTicketById", () => {
  it("calls prisma.ticket.findUnique with id and includes event", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({ id: "t1" });
    const result = await getTicketById("t1");
    expect(mockPrisma.ticket.findUnique).toHaveBeenCalledWith({
      where: { id: "t1" },
      include: { event: true },
    });
    expect(result).toEqual({ id: "t1" });
  });

  it("returns null when ticket not found", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue(null);
    const result = await getTicketById("nonexistent");
    expect(result).toBeNull();
  });
});

describe("getTicketByTokenId", () => {
  it("calls findUnique with compound key eventId_tokenId", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({ id: "t1" });
    await getTicketByTokenId("e1", 5n);
    expect(mockPrisma.ticket.findUnique).toHaveBeenCalledWith({
      where: { eventId_tokenId: { eventId: "e1", tokenId: 5n } },
      include: { event: true },
    });
  });
});

describe("updateTicketStatus", () => {
  it("calls prisma.ticket.update with status and txHash", async () => {
    mockPrisma.ticket.update.mockResolvedValue({ id: "t1" });
    await updateTicketStatus("t1", "USED" as any, "0xtx");
    expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "USED", lastTransactionHash: "0xtx" },
    });
  });

  it("omits txHash from data when not provided", async () => {
    mockPrisma.ticket.update.mockResolvedValue({ id: "t1" });
    await updateTicketStatus("t1", "USED" as any);
    expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { status: "USED", lastTransactionHash: undefined },
    });
  });
});

describe("getTicketsByOwner", () => {
  it("calls findMany filtered by ownerAddress with pagination, returns { tickets, total }", async () => {
    mockPrisma.ticket.findMany.mockResolvedValue([]);
    mockPrisma.ticket.count.mockResolvedValue(0);
    const result = await getTicketsByOwner("0xabc");
    expect(mockPrisma.ticket.findMany).toHaveBeenCalledWith({
      where: { ownerAddress: "0xabc" },
      include: { event: true },
      orderBy: { updatedAt: "desc" },
      skip: 0,
      take: 20,
    });
    expect(mockPrisma.ticket.count).toHaveBeenCalledWith({ where: { ownerAddress: "0xabc" } });
    expect(result).toEqual({ tickets: [], total: 0 });
  });
});

describe("getTicketsByEvent", () => {
  it("calls findMany filtered by eventId with pagination, returns { tickets, total }", async () => {
    mockPrisma.ticket.findMany.mockResolvedValue([]);
    mockPrisma.ticket.count.mockResolvedValue(0);
    const result = await getTicketsByEvent("e1");
    expect(mockPrisma.ticket.findMany).toHaveBeenCalledWith({
      where: { eventId: "e1" },
      orderBy: { tokenId: "asc" },
      skip: 0,
      take: 20,
    });
    expect(mockPrisma.ticket.count).toHaveBeenCalledWith({ where: { eventId: "e1" } });
    expect(result).toEqual({ tickets: [], total: 0 });
  });
});

describe("logScan", () => {
  it("creates ScanLog with isOfflineValidation defaulting to false", async () => {
    mockPrisma.scanLog.create.mockResolvedValue({ id: "s1" });
    await logScan({ ticketId: "t1", gateId: "gate-a" });
    expect(mockPrisma.scanLog.create).toHaveBeenCalledWith({
      data: {
        ticketId: "t1",
        scannerStaffId: undefined,
        gateId: "gate-a",
        isOfflineValidation: false,
      },
    });
  });

  it("creates ScanLog with isOfflineValidation true when specified", async () => {
    mockPrisma.scanLog.create.mockResolvedValue({ id: "s1" });
    await logScan({ ticketId: "t1", isOfflineValidation: true });
    expect(mockPrisma.scanLog.create).toHaveBeenCalledWith({
      data: {
        ticketId: "t1",
        scannerStaffId: undefined,
        gateId: undefined,
        isOfflineValidation: true,
      },
    });
  });
});
