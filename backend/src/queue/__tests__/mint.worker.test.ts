import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---

const {
  mockPrisma,
  mockMintTicket,
  mockSetTicketCache,
  mockInitTokenCounter,
  mockAllocateTokenId,
} = vi.hoisted(() => ({
  mockPrisma: {
    pendingMint: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    event: {
      findUnique: vi.fn(),
    },
    ticket: {
      create: vi.fn(),
    },
  },
  mockMintTicket: vi.fn(),
  mockSetTicketCache: vi.fn(),
  mockInitTokenCounter: vi.fn(),
  mockAllocateTokenId: vi.fn(),
}));

vi.mock("../../db/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../services/starknet.service", () => ({
  mintTicket: (...args: any[]) => mockMintTicket(...args),
}));

vi.mock("../../db/redis", () => ({
  setTicketCache: (...args: any[]) => mockSetTicketCache(...args),
  initTokenCounter: (...args: any[]) => mockInitTokenCounter(...args),
  allocateTokenId: (...args: any[]) => mockAllocateTokenId(...args),
  bullmqConnection: { host: "localhost", port: 6379 },
  redis: { get: vi.fn(), set: vi.fn() },
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(() => ({ add: vi.fn() })),
  Worker: vi.fn(() => ({ on: vi.fn() })),
}));

vi.mock("../../config/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { Worker } from "bullmq";

await import("../mint.worker");

const workerCalls = (Worker as unknown as ReturnType<typeof vi.fn>).mock.calls;
const mintHandler = workerCalls.find((c: any[]) => c[0] === "mint")?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  mockSetTicketCache.mockResolvedValue(undefined);
  mockInitTokenCounter.mockResolvedValue(undefined);
  mockAllocateTokenId.mockResolvedValue(BigInt(6));
});

describe("mint worker", () => {
  const makeJob = (data: any) => ({ data, id: "test-job" });

  it("skips if pendingMint not found", async () => {
    mockPrisma.pendingMint.findUnique.mockResolvedValue(null);

    await mintHandler(makeJob({
      pendingMintId: "pm-1",
      eventId: "e-1",
      buyerEmail: "buyer@test.com",
      buyerWalletAddress: "0xwallet",
    }));

    expect(mockMintTicket).not.toHaveBeenCalled();
  });

  it("skips if pendingMint status is not PENDING", async () => {
    mockPrisma.pendingMint.findUnique.mockResolvedValue({
      id: "pm-1",
      status: "MINTED",
    });

    await mintHandler(makeJob({
      pendingMintId: "pm-1",
      eventId: "e-1",
      buyerEmail: "buyer@test.com",
      buyerWalletAddress: "0xwallet",
    }));

    expect(mockMintTicket).not.toHaveBeenCalled();
  });

  it("throws if event not found", async () => {
    mockPrisma.pendingMint.findUnique.mockResolvedValue({
      id: "pm-1",
      status: "PENDING",
    });
    mockPrisma.event.findUnique.mockResolvedValue(null);

    await expect(
      mintHandler(makeJob({
        pendingMintId: "pm-1",
        eventId: "e-1",
        buyerEmail: "buyer@test.com",
        buyerWalletAddress: "0xwallet",
      }))
    ).rejects.toThrow("Event e-1 not found");
  });

  it("throws if contract not deployed (0x0)", async () => {
    mockPrisma.pendingMint.findUnique.mockResolvedValue({
      id: "pm-1",
      status: "PENDING",
    });
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "e-1",
      contractAddress: "0x0",
      maxSupply: 100,
      _count: { tickets: 0 },
    });

    await expect(
      mintHandler(makeJob({
        pendingMintId: "pm-1",
        eventId: "e-1",
        buyerEmail: "buyer@test.com",
        buyerWalletAddress: "0xwallet",
      }))
    ).rejects.toThrow("contract not deployed");
  });

  it("sets FAILED when buyer wallet is missing", async () => {
    mockPrisma.pendingMint.findUnique.mockResolvedValue({
      id: "pm-1",
      status: "PENDING",
    });
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "e-1",
      contractAddress: "0xcontract",
      maxSupply: 100,
      _count: { tickets: 0 },
    });
    mockPrisma.pendingMint.update.mockResolvedValue({});

    await expect(
      mintHandler(makeJob({
        pendingMintId: "pm-1",
        eventId: "e-1",
        buyerEmail: "buyer@test.com",
        // no buyerWalletAddress
      }))
    ).rejects.toThrow("buyer wallet address is required");

    expect(mockPrisma.pendingMint.update).toHaveBeenCalledWith({
      where: { id: "pm-1" },
      data: { status: "FAILED" },
    });
  });

  it("sets FAILED when max supply reached", async () => {
    mockPrisma.pendingMint.findUnique.mockResolvedValue({
      id: "pm-1",
      status: "PENDING",
    });
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "e-1",
      contractAddress: "0xcontract",
      maxSupply: 10,
      _count: { tickets: 10 },
    });
    mockPrisma.pendingMint.update.mockResolvedValue({});

    await expect(
      mintHandler(makeJob({
        pendingMintId: "pm-1",
        eventId: "e-1",
        buyerEmail: "buyer@test.com",
        buyerWalletAddress: "0xwallet",
      }))
    ).rejects.toThrow("max supply");

    expect(mockPrisma.pendingMint.update).toHaveBeenCalledWith({
      where: { id: "pm-1" },
      data: { status: "FAILED" },
    });
  });

  it("mints ticket and updates status to MINTED on success", async () => {
    mockPrisma.pendingMint.findUnique.mockResolvedValue({
      id: "pm-1",
      status: "PENDING",
    });
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "e-1",
      contractAddress: "0xcontract",
      maxSupply: 100,
      _count: { tickets: 5 },
    });
    mockMintTicket.mockResolvedValue("0xtx_mint");
    mockPrisma.ticket.create.mockResolvedValue({
      id: "ticket-1",
      eventId: "e-1",
      tokenId: BigInt(6),
      ownerAddress: "0xwallet",
    });
    mockPrisma.pendingMint.update.mockResolvedValue({});

    await mintHandler(makeJob({
      pendingMintId: "pm-1",
      eventId: "e-1",
      buyerEmail: "buyer@test.com",
      buyerWalletAddress: "0xwallet",
    }));

    expect(mockMintTicket).toHaveBeenCalledWith("0xcontract", "0xwallet", BigInt(6));

    expect(mockPrisma.ticket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: "e-1",
        tokenId: BigInt(6),
        ownerAddress: "0xwallet",
        ownerEmail: "buyer@test.com",
        lastTransactionHash: "0xtx_mint",
      }),
    });

    expect(mockPrisma.pendingMint.update).toHaveBeenCalledWith({
      where: { id: "pm-1" },
      data: { status: "MINTED", txHash: "0xtx_mint" },
    });
  });

  it("caches ticket after mint", async () => {
    mockPrisma.pendingMint.findUnique.mockResolvedValue({
      id: "pm-1",
      status: "PENDING",
    });
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "e-1",
      contractAddress: "0xcontract",
      maxSupply: 100,
      _count: { tickets: 5 },
    });
    mockMintTicket.mockResolvedValue("0xtx_mint");
    mockPrisma.ticket.create.mockResolvedValue({
      id: "ticket-1",
      eventId: "e-1",
      tokenId: BigInt(6),
      ownerAddress: "0xwallet",
    });
    mockPrisma.pendingMint.update.mockResolvedValue({});

    await mintHandler(makeJob({
      pendingMintId: "pm-1",
      eventId: "e-1",
      buyerEmail: "buyer@test.com",
      buyerWalletAddress: "0xwallet",
    }));

    expect(mockSetTicketCache).toHaveBeenCalledWith("ticket-1", {
      status: "AVAILABLE",
      ownerAddress: "0xwallet",
      ownerName: "buyer@test.com",
    });
  });

  it("sets FAILED on mint error and rethrows", async () => {
    mockPrisma.pendingMint.findUnique.mockResolvedValue({
      id: "pm-1",
      status: "PENDING",
    });
    mockPrisma.event.findUnique.mockResolvedValue({
      id: "e-1",
      contractAddress: "0xcontract",
      maxSupply: 100,
      _count: { tickets: 0 },
    });
    mockMintTicket.mockRejectedValue(new Error("RPC timeout"));
    mockPrisma.pendingMint.update.mockResolvedValue({});

    await expect(
      mintHandler(makeJob({
        pendingMintId: "pm-1",
        eventId: "e-1",
        buyerEmail: "buyer@test.com",
        buyerWalletAddress: "0xwallet",
      }))
    ).rejects.toThrow("RPC timeout");

    expect(mockPrisma.pendingMint.update).toHaveBeenCalledWith({
      where: { id: "pm-1" },
      data: { status: "FAILED" },
    });
  });
});
