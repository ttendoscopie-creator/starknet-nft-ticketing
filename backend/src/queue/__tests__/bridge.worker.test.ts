import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---

const {
  mockPrisma,
  mockMintTicket,
  mockTransferTicket,
  mockAddMarketplace,
  mockIsMarketplaceAllowed,
  mockSetTicketCache,
  mockRedisGet,
  mockRedisSet,
} = vi.hoisted(() => ({
  mockPrisma: {
    bridgedTicket: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    event: {
      findUnique: vi.fn(),
    },
    ticket: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  mockMintTicket: vi.fn(),
  mockTransferTicket: vi.fn(),
  mockAddMarketplace: vi.fn(),
  mockIsMarketplaceAllowed: vi.fn(),
  mockSetTicketCache: vi.fn(),
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
}));

vi.mock("../../db/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../services/starknet.service", () => ({
  mintTicket: (...args: any[]) => mockMintTicket(...args),
  transferTicket: (...args: any[]) => mockTransferTicket(...args),
  addMarketplace: (...args: any[]) => mockAddMarketplace(...args),
  isMarketplaceAllowed: (...args: any[]) => mockIsMarketplaceAllowed(...args),
}));

vi.mock("../../db/redis", () => ({
  setTicketCache: (...args: any[]) => mockSetTicketCache(...args),
  bullmqConnection: { host: "localhost", port: 6379 },
  redis: { get: mockRedisGet, set: mockRedisSet },
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(() => ({ add: vi.fn() })),
  Worker: vi.fn(() => ({ on: vi.fn() })),
}));

vi.mock("../../config/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// We can't import the actual worker (it runs side-effect Worker constructors),
// so we test the logic by importing the module and extracting the handler.
// Instead, we'll directly test the logic that the workers execute.

// The worker handler is embedded in the module. Since BullMQ Worker is mocked,
// we capture the handler function via the mock.
import { Worker } from "bullmq";

// Re-import to trigger module execution (workers register via mocked constructors)
await import("../bridge.worker");

// Extract the handler functions that were passed to Worker constructors
const workerCalls = (Worker as unknown as ReturnType<typeof vi.fn>).mock.calls;
const bridgeMintHandler = workerCalls.find((c: any[]) => c[0] === "bridgeMint")?.[1];
const bridgeClaimHandler = workerCalls.find((c: any[]) => c[0] === "bridgeClaim")?.[1];

const VAULT_ADDRESS = process.env.DEPLOYER_ADDRESS || "0xdef456";

beforeEach(() => {
  vi.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue("OK");
  mockSetTicketCache.mockResolvedValue(undefined);
});

// ── Bridge Mint Worker ────────────────────────────────────────────────

describe("bridgeMint worker", () => {
  const makeJob = (data: any) => ({ data, id: "test-job" });

  it("skips if bridged ticket is not PENDING", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: "bt-1",
      status: "MINTED",
    });

    await bridgeMintHandler(makeJob({
      bridgedTicketId: "bt-1",
      eventId: "e-1",
      ownerEmail: "buyer@test.com",
    }));

    expect(mockMintTicket).not.toHaveBeenCalled();
  });

  it("throws if event not found", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: "bt-1",
      status: "PENDING",
    });
    mockPrisma.event.findUnique.mockResolvedValue(null);

    await expect(
      bridgeMintHandler(makeJob({
        bridgedTicketId: "bt-1",
        eventId: "e-1",
        ownerEmail: "buyer@test.com",
      }))
    ).rejects.toThrow("Event e-1 not found");
  });

  it("rejects soulbound events", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: "bt-1",
      status: "PENDING",
    });
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "e-1",
      contractAddress: "0xcontract",
      isSoulbound: true,
      maxSupply: 100,
      _count: { tickets: 0 },
    });
    mockPrisma.bridgedTicket.update.mockResolvedValue({});

    await expect(
      bridgeMintHandler(makeJob({
        bridgedTicketId: "bt-1",
        eventId: "e-1",
        ownerEmail: "buyer@test.com",
      }))
    ).rejects.toThrow("soulbound");

    expect(mockPrisma.bridgedTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bt-1" },
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });

  it("rejects when max supply is reached", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: "bt-1",
      status: "PENDING",
    });
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "e-1",
      contractAddress: "0xcontract",
      isSoulbound: false,
      maxSupply: 10,
      _count: { tickets: 10 },
    });
    mockPrisma.bridgedTicket.update.mockResolvedValue({});

    await expect(
      bridgeMintHandler(makeJob({
        bridgedTicketId: "bt-1",
        eventId: "e-1",
        ownerEmail: "buyer@test.com",
      }))
    ).rejects.toThrow("max supply");
  });

  it("mints ticket to vault and updates status to MINTED", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: "bt-1",
      status: "PENDING",
    });
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "e-1",
      contractAddress: "0xcontract",
      isSoulbound: false,
      maxSupply: 100,
      _count: { tickets: 5 },
    });
    mockMintTicket.mockResolvedValue("0xtx_mint");
    mockPrisma.ticket.create.mockResolvedValue({
      id: "ticket-1",
      eventId: "e-1",
      tokenId: BigInt(6),
      ownerAddress: VAULT_ADDRESS,
    });
    mockPrisma.bridgedTicket.update.mockResolvedValue({});

    await bridgeMintHandler(makeJob({
      bridgedTicketId: "bt-1",
      eventId: "e-1",
      ownerEmail: "buyer@test.com",
    }));

    expect(mockMintTicket).toHaveBeenCalledWith("0xcontract", VAULT_ADDRESS, BigInt(6));

    expect(mockPrisma.ticket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: "e-1",
        tokenId: BigInt(6),
        ownerAddress: VAULT_ADDRESS,
        ownerEmail: "buyer@test.com",
      }),
    });

    expect(mockPrisma.bridgedTicket.update).toHaveBeenCalledWith({
      where: { id: "bt-1" },
      data: expect.objectContaining({
        status: "MINTED",
        tokenId: BigInt(6),
        ticketId: "ticket-1",
        mintTxHash: "0xtx_mint",
      }),
    });

    expect(mockSetTicketCache).toHaveBeenCalledWith("ticket-1", {
      status: "AVAILABLE",
      ownerAddress: VAULT_ADDRESS,
      ownerName: "buyer@test.com",
    });
  });

  it("sets status to FAILED on mint error", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: "bt-1",
      status: "PENDING",
    });
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "e-1",
      contractAddress: "0xcontract",
      isSoulbound: false,
      maxSupply: 100,
      _count: { tickets: 0 },
    });
    mockMintTicket.mockRejectedValue(new Error("RPC timeout"));
    mockPrisma.bridgedTicket.update.mockResolvedValue({});

    await expect(
      bridgeMintHandler(makeJob({
        bridgedTicketId: "bt-1",
        eventId: "e-1",
        ownerEmail: "buyer@test.com",
      }))
    ).rejects.toThrow("RPC timeout");

    expect(mockPrisma.bridgedTicket.update).toHaveBeenCalledWith({
      where: { id: "bt-1" },
      data: expect.objectContaining({ status: "FAILED", errorMessage: "RPC timeout" }),
    });
  });
});

// ── Bridge Claim Worker ───────────────────────────────────────────────

describe("bridgeClaim worker", () => {
  const makeJob = (data: any) => ({ data, id: "test-claim-job" });

  it("skips if bridged ticket is not MINTED", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: "bt-1",
      status: "CLAIMED",
      ticket: null,
      event: null,
    });

    await bridgeClaimHandler(makeJob({
      bridgedTicketId: "bt-1",
      toAddress: "0xuser",
    }));

    expect(mockTransferTicket).not.toHaveBeenCalled();
  });

  it("calls addMarketplace if deployer not whitelisted", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: "bt-1",
      status: "MINTED",
      tokenId: BigInt(1),
      ticketId: "ticket-1",
      ownerEmail: "buyer@test.com",
      ticket: { id: "ticket-1", status: "AVAILABLE" },
      event: { id: "e-1", contractAddress: "0xcontract" },
    });
    mockRedisGet.mockResolvedValue(null); // not cached
    mockIsMarketplaceAllowed.mockResolvedValue(false);
    mockAddMarketplace.mockResolvedValue("0xtx_add");
    mockTransferTicket.mockResolvedValue("0xtx_transfer");
    mockPrisma.ticket.update.mockResolvedValue({});
    mockPrisma.bridgedTicket.update.mockResolvedValue({});

    await bridgeClaimHandler(makeJob({
      bridgedTicketId: "bt-1",
      toAddress: "0xuser",
    }));

    expect(mockAddMarketplace).toHaveBeenCalledWith("0xcontract", VAULT_ADDRESS);
    expect(mockTransferTicket).toHaveBeenCalledWith(
      "0xcontract", VAULT_ADDRESS, "0xuser", BigInt(1), 0n
    );
  });

  it("skips addMarketplace if cached", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: "bt-1",
      status: "MINTED",
      tokenId: BigInt(1),
      ticketId: "ticket-1",
      ownerEmail: "buyer@test.com",
      ticket: { id: "ticket-1", status: "AVAILABLE" },
      event: { id: "e-1", contractAddress: "0xcontract" },
    });
    mockRedisGet.mockResolvedValue("1"); // cached
    mockTransferTicket.mockResolvedValue("0xtx_transfer");
    mockPrisma.ticket.update.mockResolvedValue({});
    mockPrisma.bridgedTicket.update.mockResolvedValue({});

    await bridgeClaimHandler(makeJob({
      bridgedTicketId: "bt-1",
      toAddress: "0xuser",
    }));

    expect(mockIsMarketplaceAllowed).not.toHaveBeenCalled();
    expect(mockAddMarketplace).not.toHaveBeenCalled();
    expect(mockTransferTicket).toHaveBeenCalled();
  });

  it("updates ticket owner and bridged ticket status on successful claim", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: "bt-1",
      status: "MINTED",
      tokenId: BigInt(1),
      ticketId: "ticket-1",
      ownerEmail: "buyer@test.com",
      ticket: { id: "ticket-1", status: "AVAILABLE" },
      event: { id: "e-1", contractAddress: "0xcontract" },
    });
    mockRedisGet.mockResolvedValue("1");
    mockTransferTicket.mockResolvedValue("0xtx_claim");
    mockPrisma.ticket.update.mockResolvedValue({});
    mockPrisma.bridgedTicket.update.mockResolvedValue({});

    await bridgeClaimHandler(makeJob({
      bridgedTicketId: "bt-1",
      toAddress: "0xuser_wallet",
    }));

    expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: { ownerAddress: "0xuser_wallet", lastTransactionHash: "0xtx_claim" },
    });

    expect(mockPrisma.bridgedTicket.update).toHaveBeenCalledWith({
      where: { id: "bt-1" },
      data: expect.objectContaining({
        status: "CLAIMED",
        claimedByAddress: "0xuser_wallet",
        claimTxHash: "0xtx_claim",
      }),
    });

    expect(mockSetTicketCache).toHaveBeenCalledWith("ticket-1", {
      status: "AVAILABLE",
      ownerAddress: "0xuser_wallet",
      ownerName: "buyer@test.com",
    });
  });

  it("sets error on transfer failure but does not set FAILED status", async () => {
    mockPrisma.bridgedTicket.findUnique.mockResolvedValue({
      id: "bt-1",
      status: "MINTED",
      tokenId: BigInt(1),
      ticketId: "ticket-1",
      ownerEmail: "buyer@test.com",
      ticket: { id: "ticket-1", status: "AVAILABLE" },
      event: { id: "e-1", contractAddress: "0xcontract" },
    });
    mockRedisGet.mockResolvedValue("1");
    mockTransferTicket.mockRejectedValue(new Error("MARKETPLACE_NOT_ALLOWED"));
    mockPrisma.bridgedTicket.update.mockResolvedValue({});

    await expect(
      bridgeClaimHandler(makeJob({
        bridgedTicketId: "bt-1",
        toAddress: "0xuser",
      }))
    ).rejects.toThrow("MARKETPLACE_NOT_ALLOWED");

    expect(mockPrisma.bridgedTicket.update).toHaveBeenCalledWith({
      where: { id: "bt-1" },
      data: { errorMessage: "MARKETPLACE_NOT_ALLOWED" },
    });
  });
});
