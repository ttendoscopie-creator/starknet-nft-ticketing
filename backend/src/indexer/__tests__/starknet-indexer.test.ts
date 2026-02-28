import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetBlockLatestAccepted,
  mockGetEvents,
  mockRedisGet,
  mockRedisSet,
  mockRedisPing,
  mockSetTicketCache,
  mockPrisma,
  SELECTOR_MAP,
} = vi.hoisted(() => ({
  mockGetBlockLatestAccepted: vi.fn(),
  mockGetEvents: vi.fn(),
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
  mockRedisPing: vi.fn(),
  mockSetTicketCache: vi.fn(),
  mockPrisma: {
    event: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    ticket: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    listing: {
      updateMany: vi.fn(),
    },
    scanLog: {
      updateMany: vi.fn(),
    },
  },
  SELECTOR_MAP: {
    TicketMinted: "0xaaa1",
    TicketTransferred: "0xaaa2",
    TicketUsed: "0xaaa3",
    EventCreated: "0xaaa4",
  } as Record<string, string>,
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("../../db/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../db/redis", () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    ping: mockRedisPing,
  },
  setTicketCache: mockSetTicketCache,
}));

vi.mock("../../config/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("starknet", () => ({
  RpcProvider: vi.fn(() => ({
    getBlockLatestAccepted: mockGetBlockLatestAccepted,
    getEvents: mockGetEvents,
  })),
  num: {
    toHex: (val: string | bigint) => {
      if (typeof val === "bigint") return `0x${val.toString(16)}`;
      return String(val);
    },
  },
  hash: {
    getSelectorFromName: (name: string) => SELECTOR_MAP[name] ?? "0x0",
  },
}));

// ---------------------------------------------------------------------------
// Import under test — MUST come after vi.mock calls
// ---------------------------------------------------------------------------
import { pollEvents } from "../starknet-indexer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const CONTRACT_ADDR = "0xcontract1";

function makeEvent(
  address: string,
  selectorHex: string,
  data: string[],
  keys: string[] = [selectorHex]
) {
  return { keys, data, from_address: address };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  // Default: indexer state starts at block 0
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue("OK");
});

describe("pollEvents", () => {
  // ----- 1 -----
  it("returns early when no new blocks", async () => {
    // Indexer state already at block 50, latest block is also 50
    mockRedisGet.mockResolvedValue(JSON.stringify({ lastIndexedBlock: 50 }));
    mockGetBlockLatestAccepted.mockResolvedValue({ block_number: 50 });

    await pollEvents();

    // Should not query events or save state
    expect(mockPrisma.event.findMany).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  // ----- 2 -----
  it("processes TicketMinted event correctly", async () => {
    mockGetBlockLatestAccepted.mockResolvedValue({ block_number: 10 });
    mockPrisma.event.findMany.mockResolvedValue([
      { contractAddress: CONTRACT_ADDR },
    ]);
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "evt-1",
      contractAddress: CONTRACT_ADDR,
    });

    const mintedTicket = { id: "ticket-1", ownerAddress: "0xbuyer" };
    mockPrisma.ticket.upsert.mockResolvedValue(mintedTicket);
    mockSetTicketCache.mockResolvedValue(undefined);

    // TicketMinted data: [toAddress, tokenIdLow, tokenIdHigh]
    mockGetEvents.mockResolvedValue({
      events: [
        makeEvent(CONTRACT_ADDR, SELECTOR_MAP.TicketMinted, [
          "0xbuyer", // to
          "42",      // tokenIdLow
          "0",       // tokenIdHigh
        ]),
      ],
    });

    await pollEvents();

    expect(mockPrisma.ticket.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId_tokenId: { eventId: "evt-1", tokenId: 42n } },
        create: expect.objectContaining({
          eventId: "evt-1",
          ownerAddress: "0xbuyer",
        }),
        update: expect.objectContaining({ ownerAddress: "0xbuyer" }),
      })
    );
    expect(mockSetTicketCache).toHaveBeenCalledWith("ticket-1", {
      status: "AVAILABLE",
      ownerAddress: "0xbuyer",
    });
    // State should be saved
    expect(mockRedisSet).toHaveBeenCalledWith(
      "indexer:state",
      expect.any(String)
    );
  });

  // ----- 3 -----
  it("processes TicketTransferred event -- updates owner + deactivates listings", async () => {
    mockGetBlockLatestAccepted.mockResolvedValue({ block_number: 5 });
    mockPrisma.event.findMany.mockResolvedValue([
      { contractAddress: CONTRACT_ADDR },
    ]);
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "evt-2",
      contractAddress: CONTRACT_ADDR,
    });

    const updatedTicket = { id: "ticket-2", ownerAddress: "0xnewowner" };
    mockPrisma.ticket.update.mockResolvedValue(updatedTicket);
    mockPrisma.listing.updateMany.mockResolvedValue({ count: 1 });
    mockSetTicketCache.mockResolvedValue(undefined);

    // TicketTransferred data: [fromAddress, toAddress, tokenIdLow, tokenIdHigh]
    mockGetEvents.mockResolvedValue({
      events: [
        makeEvent(CONTRACT_ADDR, SELECTOR_MAP.TicketTransferred, [
          "0xoldowner", // from
          "0xnewowner", // to
          "7",          // tokenIdLow
          "0",          // tokenIdHigh
        ]),
      ],
    });

    await pollEvents();

    expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId_tokenId: { eventId: "evt-2", tokenId: 7n } },
        data: expect.objectContaining({
          ownerAddress: "0xnewowner",
          status: "AVAILABLE",
        }),
      })
    );
    expect(mockPrisma.listing.updateMany).toHaveBeenCalledWith({
      where: { ticketId: "ticket-2", isActive: true },
      data: { isActive: false },
    });
    expect(mockSetTicketCache).toHaveBeenCalledWith("ticket-2", {
      status: "AVAILABLE",
      ownerAddress: "0xnewowner",
    });
  });

  // ----- 4 -----
  it("processes TicketUsed event -- updates status", async () => {
    mockGetBlockLatestAccepted.mockResolvedValue({ block_number: 3 });
    mockPrisma.event.findMany.mockResolvedValue([
      { contractAddress: CONTRACT_ADDR },
    ]);
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "evt-3",
      contractAddress: CONTRACT_ADDR,
    });

    const usedTicket = { id: "ticket-3", ownerAddress: "0xholder", status: "USED" };
    mockPrisma.ticket.update.mockResolvedValue(usedTicket);
    mockSetTicketCache.mockResolvedValue(undefined);

    // TicketUsed data: [tokenIdLow, tokenIdHigh]
    mockGetEvents.mockResolvedValue({
      events: [
        makeEvent(CONTRACT_ADDR, SELECTOR_MAP.TicketUsed, [
          "99", // tokenIdLow
          "0",  // tokenIdHigh
        ]),
      ],
    });

    await pollEvents();

    expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId_tokenId: { eventId: "evt-3", tokenId: 99n } },
        data: { status: "USED" },
      })
    );
    expect(mockSetTicketCache).toHaveBeenCalledWith("ticket-3", {
      status: "USED",
      ownerAddress: "0xholder",
    });
  });

  // ----- 5 -----
  it("processes EventCreated -- updates contract address", async () => {
    const factoryAddr = "0xfactory";
    // We need the factory address to be in the polled list.
    // Since FACTORY_ADDRESS env is empty by default, we add it via findMany result + factory env.
    // Instead, we simulate it by having it show up in the addresses list.
    // The factory address is added if env FACTORY_ADDRESS is set — here it's empty, so
    // we make the factory address show up as a contractAddress in a prisma event record.
    mockGetBlockLatestAccepted.mockResolvedValue({ block_number: 2 });
    mockPrisma.event.findMany.mockResolvedValue([
      { contractAddress: factoryAddr },
    ]);
    mockPrisma.event.updateMany.mockResolvedValue({ count: 1 });

    // EventCreated data: [eventIdLow, eventIdHigh, contractAddress, organizer]
    mockGetEvents.mockResolvedValue({
      events: [
        makeEvent(factoryAddr, SELECTOR_MAP.EventCreated, [
          "1",             // eventIdLow
          "0",             // eventIdHigh (unused in handler but present)
          "0xdeployed",    // contractAddress
          "0xorganizer",   // organizer
        ]),
      ],
    });

    await pollEvents();

    expect(mockPrisma.event.updateMany).toHaveBeenCalledWith({
      where: {
        contractAddress: "0x0",
        organizer: { treasuryAddress: "0xorganizer" },
      },
      data: { contractAddress: "0xdeployed" },
    });
  });

  // ----- 6 -----
  it("skips unknown event selectors", async () => {
    mockGetBlockLatestAccepted.mockResolvedValue({ block_number: 5 });
    mockPrisma.event.findMany.mockResolvedValue([
      { contractAddress: CONTRACT_ADDR },
    ]);

    mockGetEvents.mockResolvedValue({
      events: [
        makeEvent(CONTRACT_ADDR, "0xunknown_selector", ["0x1", "0x2"]),
      ],
    });

    await pollEvents();

    // No processing functions should have been called
    expect(mockPrisma.event.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.ticket.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
    expect(mockPrisma.event.updateMany).not.toHaveBeenCalled();
    // State should still be saved (indexer progresses past these blocks)
    expect(mockRedisSet).toHaveBeenCalled();
  });

  // ----- 7 -----
  it("handles RPC error gracefully", async () => {
    mockGetBlockLatestAccepted.mockRejectedValue(new Error("RPC unavailable"));

    await pollEvents();

    // Should return early without crashing
    expect(mockPrisma.event.findMany).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  // ----- 8 -----
  it("skips events for unknown contracts", async () => {
    mockGetBlockLatestAccepted.mockResolvedValue({ block_number: 5 });
    mockPrisma.event.findMany.mockResolvedValue([
      { contractAddress: CONTRACT_ADDR },
    ]);

    // Event is a TicketMinted but for a contract not in our DB
    mockPrisma.event.findUnique.mockResolvedValue(null);

    mockGetEvents.mockResolvedValue({
      events: [
        makeEvent(CONTRACT_ADDR, SELECTOR_MAP.TicketMinted, [
          "0xbuyer",
          "1",
          "0",
        ]),
      ],
    });

    await pollEvents();

    // findUnique returned null, so ticket upsert should NOT be called
    expect(mockPrisma.ticket.upsert).not.toHaveBeenCalled();
    expect(mockSetTicketCache).not.toHaveBeenCalled();
  });
});
