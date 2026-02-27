import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockExecute, mockWaitForTransaction, mockCallContract, mockToHex, mockCompile, mockGetTransactionReceipt } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockWaitForTransaction: vi.fn(),
  mockCallContract: vi.fn(),
  mockToHex: vi.fn(),
  mockCompile: vi.fn(),
  mockGetTransactionReceipt: vi.fn(),
}));

vi.mock("../../config/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("starknet", () => ({
  RpcProvider: vi.fn(() => ({
    waitForTransaction: mockWaitForTransaction,
    callContract: mockCallContract,
    getTransactionReceipt: mockGetTransactionReceipt,
  })),
  Account: vi.fn(() => ({
    execute: mockExecute,
  })),
  CallData: {
    compile: mockCompile,
  },
  num: {
    toHex: mockToHex,
  },
}));

import { mintTicket, markUsedBatch, getOwner, isUsed, verifyERC20Transfer, getERC20Balance } from "../starknet.service";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // Restore implementations after clearAllMocks
  mockToHex.mockImplementation((val: string) => val);
  mockCompile.mockImplementation((data: any) => data);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mintTicket", () => {
  it("calls execute and waitForTransaction, returns txHash", async () => {
    mockExecute.mockResolvedValue({ transaction_hash: "0xtx1" });
    mockWaitForTransaction.mockResolvedValue({});

    const txHash = await mintTicket("0xcontract", "0xto", 1n);

    expect(txHash).toBe("0xtx1");
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockWaitForTransaction).toHaveBeenCalledWith("0xtx1");
  });

  it("retries on first failure, succeeds on second attempt", async () => {
    mockExecute
      .mockRejectedValueOnce(new Error("RPC timeout"))
      .mockResolvedValueOnce({ transaction_hash: "0xtx2" });
    mockWaitForTransaction.mockResolvedValue({});

    const promise = mintTicket("0xcontract", "0xto", 1n);

    // Advance past first backoff (1000ms)
    await vi.advanceTimersByTimeAsync(1500);

    const txHash = await promise;
    expect(txHash).toBe("0xtx2");
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("retries up to 3 times then throws the last error", async () => {
    vi.useRealTimers();
    mockExecute.mockRejectedValue(new Error("fetch failed"));

    await expect(mintTicket("0xcontract", "0xto", 1n)).rejects.toThrow("fetch failed");
    expect(mockExecute).toHaveBeenCalledTimes(3);

    vi.useFakeTimers();
  });

  it("does not retry non-transient errors", async () => {
    vi.useRealTimers();
    mockExecute.mockRejectedValue(new Error("Contract reverted: insufficient balance"));

    await expect(mintTicket("0xcontract", "0xto", 1n)).rejects.toThrow("Contract reverted");
    expect(mockExecute).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
  });
});

describe("markUsedBatch", () => {
  it("executes multicall and returns txHash", async () => {
    mockExecute.mockResolvedValue({ transaction_hash: "0xbatch" });
    mockWaitForTransaction.mockResolvedValue({});

    const txHash = await markUsedBatch("0xcontract", [1n, 2n, 3n]);

    expect(txHash).toBe("0xbatch");
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const calls = mockExecute.mock.calls[0][0];
    expect(calls).toHaveLength(3);
  });
});

describe("getOwner", () => {
  it("calls callContract with owner_of and returns hex address", async () => {
    mockCallContract.mockResolvedValue(["0xowner"]);

    const owner = await getOwner("0xcontract", 1n);

    expect(owner).toBe("0xowner");
    expect(mockCallContract).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: "0xcontract",
        entrypoint: "owner_of",
      })
    );
  });
});

describe("isUsed", () => {
  it("returns true when contract returns non-zero", async () => {
    mockCallContract.mockResolvedValue(["0x1"]);

    const result = await isUsed("0xcontract", 1n);
    expect(result).toBe(true);
  });

  it("returns false when contract returns 0x0", async () => {
    mockCallContract.mockResolvedValue(["0x0"]);

    const result = await isUsed("0xcontract", 1n);
    expect(result).toBe(false);
  });
});

describe("verifyERC20Transfer", () => {
  it("returns true when Transfer event matches expected recipient and amount", async () => {
    mockGetTransactionReceipt.mockResolvedValue({
      statusReceipt: "success",
      events: [
        {
          from_address: "0xtoken",
          data: ["0xsender", "0xrecipient", "0x100", "0x0"],
        },
      ],
    });

    const result = await verifyERC20Transfer("0xtx", "0xrecipient", 256n, "0xtoken");
    expect(result).toBe(true);
  });

  it("returns false when receipt status is not success", async () => {
    mockGetTransactionReceipt.mockResolvedValue({
      statusReceipt: "reverted",
      events: [],
    });

    const result = await verifyERC20Transfer("0xtx", "0xrecipient", 100n, "0xtoken");
    expect(result).toBe(false);
  });
});

describe("getERC20Balance", () => {
  it("returns balance from balance_of call", async () => {
    mockCallContract.mockResolvedValue(["0x3e8", "0x0"]); // 1000

    const balance = await getERC20Balance("0xtoken", "0xaccount");
    expect(balance).toBe(1000n);
    expect(mockCallContract).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: "0xtoken",
        entrypoint: "balance_of",
      })
    );
  });
});
