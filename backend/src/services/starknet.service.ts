import { RpcProvider, Account, Contract, CallData, num, hash } from "starknet";
import { logger } from "../config/logger";

const STARKNET_RPC_URL =
  process.env.STARKNET_RPC_URL || "https://starknet-sepolia.public.blastapi.io";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY!;
const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS!;
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || "";

const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });
const account = new Account(provider, DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY);

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const TX_TIMEOUT_MS = 60_000;

// --- Circuit Breaker ---

class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  private readonly threshold: number;
  private readonly resetMs: number;

  constructor(threshold = 5, resetMs = 30_000) {
    this.threshold = threshold;
    this.resetMs = resetMs;
  }

  canExecute(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      if (Date.now() - this.lastFailure > this.resetMs) {
        this.state = "half-open";
        return true;
      }
      return false;
    }
    return true; // half-open: allow one attempt
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.threshold) {
      this.state = "open";
      logger.warn({ failures: this.failures }, "Circuit breaker opened — RPC failures threshold reached");
    }
  }

  getState(): string {
    return this.state;
  }
}

export const rpcCircuitBreaker = new CircuitBreaker();

// --- Timeout helper ---

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`RPC timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// --- Transient error detection ---

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("502")
  );
}

// --- Retry with circuit breaker ---

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (!rpcCircuitBreaker.canExecute()) {
      throw new Error("Circuit breaker open — Starknet RPC unavailable");
    }
    try {
      const result = await fn();
      rpcCircuitBreaker.onSuccess();
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      rpcCircuitBreaker.onFailure();

      // Don't retry non-transient errors (e.g., contract revert, invalid args)
      if (!isTransientError(err)) {
        throw lastError;
      }

      if (attempt < MAX_RETRIES - 1) {
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

export interface DeployEventParams {
  maxSupply: number;
  primaryPrice: bigint;
  resaleCapBps: number;
  royaltyBps: number;
  marketplaceAddress: string;
  isSoulbound: boolean;
  maxTransfers: number;
}

export async function deployEventContract(params: DeployEventParams): Promise<string> {
  if (!FACTORY_ADDRESS) {
    throw new Error("FACTORY_ADDRESS not configured");
  }

  return withRetry(async () => {
    const result = await account.execute({
      contractAddress: FACTORY_ADDRESS,
      entrypoint: "create_event",
      calldata: CallData.compile({
        max_supply: params.maxSupply,
        primary_price: params.primaryPrice,
        resale_cap_bps: params.resaleCapBps,
        royalty_bps: params.royaltyBps,
        marketplace: params.marketplaceAddress,
        soulbound: params.isSoulbound ? 1 : 0,
        max_transfers: params.maxTransfers,
      }),
    });

    const receipt = await withTimeout(
      provider.waitForTransaction(result.transaction_hash),
      TX_TIMEOUT_MS
    );

    // Parse EventCreated event from receipt to get deployed contract address
    const eventCreatedSelector = hash.getSelectorFromName("EventCreated");
    const events = (receipt as any).events ?? [];
    for (const evt of events) {
      if (evt.keys?.length > 0 && num.toHex(evt.keys[0]) === num.toHex(eventCreatedSelector)) {
        // EventCreated { event_id: u256, contract_address: ContractAddress, organizer: ContractAddress }
        // data: [event_id_low, event_id_high, contract_address, organizer]
        const contractAddress = num.toHex(evt.data[2]);
        return contractAddress;
      }
    }

    throw new Error("EventCreated event not found in transaction receipt");
  });
}

export async function mintTicket(
  contractAddress: string,
  toAddress: string,
  tokenId: bigint
): Promise<string> {
  return withRetry(async () => {
    const result = await account.execute({
      contractAddress,
      entrypoint: "mint",
      calldata: CallData.compile({
        to: toAddress,
        token_id: { low: tokenId & BigInt("0xFFFFFFFFFFFFFFFF"), high: tokenId >> 128n },
      }),
    });
    await withTimeout(
      provider.waitForTransaction(result.transaction_hash),
      TX_TIMEOUT_MS
    );
    return result.transaction_hash;
  });
}

export async function markUsedBatch(
  contractAddress: string,
  tokenIds: bigint[]
): Promise<string> {
  return withRetry(async () => {
    const calls = tokenIds.map((tokenId) => ({
      contractAddress,
      entrypoint: "mark_used",
      calldata: CallData.compile({
        token_id: { low: tokenId & BigInt("0xFFFFFFFFFFFFFFFF"), high: tokenId >> 128n },
      }),
    }));
    const result = await account.execute(calls);
    await withTimeout(
      provider.waitForTransaction(result.transaction_hash),
      TX_TIMEOUT_MS
    );
    return result.transaction_hash;
  });
}

export async function getOwner(
  contractAddress: string,
  tokenId: bigint
): Promise<string> {
  return withRetry(async () => {
    const result = await provider.callContract({
      contractAddress,
      entrypoint: "owner_of",
      calldata: CallData.compile({
        token_id: { low: tokenId & BigInt("0xFFFFFFFFFFFFFFFF"), high: tokenId >> 128n },
      }),
    });
    return num.toHex(result[0]);
  });
}

export async function isUsed(
  contractAddress: string,
  tokenId: bigint
): Promise<boolean> {
  return withRetry(async () => {
    const result = await provider.callContract({
      contractAddress,
      entrypoint: "is_used",
      calldata: CallData.compile({
        token_id: { low: tokenId & BigInt("0xFFFFFFFFFFFFFFFF"), high: tokenId >> 128n },
      }),
    });
    return result[0] !== "0x0";
  });
}

export async function isSoulbound(contractAddress: string): Promise<boolean> {
  return withRetry(async () => {
    const result = await provider.callContract({
      contractAddress,
      entrypoint: "is_soulbound",
      calldata: [],
    });
    return result[0] !== "0x0";
  });
}

export async function getTransferCount(
  contractAddress: string,
  tokenId: bigint
): Promise<number> {
  return withRetry(async () => {
    const result = await provider.callContract({
      contractAddress,
      entrypoint: "get_transfer_count",
      calldata: CallData.compile({
        token_id: { low: tokenId & BigInt("0xFFFFFFFFFFFFFFFF"), high: tokenId >> 128n },
      }),
    });
    return Number(result[0]);
  });
}

export async function revokeTicket(
  contractAddress: string,
  tokenId: bigint
): Promise<string> {
  return withRetry(async () => {
    const result = await account.execute({
      contractAddress,
      entrypoint: "revoke_ticket",
      calldata: CallData.compile({
        token_id: { low: tokenId & BigInt("0xFFFFFFFFFFFFFFFF"), high: tokenId >> 128n },
      }),
    });
    await withTimeout(
      provider.waitForTransaction(result.transaction_hash),
      TX_TIMEOUT_MS
    );
    return result.transaction_hash;
  });
}

export async function verifyERC20Transfer(
  txHash: string,
  expectedRecipient: string,
  expectedAmount: bigint,
  tokenAddress: string,
): Promise<boolean> {
  return withRetry(async () => {
    const receipt = await provider.getTransactionReceipt(txHash) as any;
    if (!receipt || receipt.statusReceipt !== "success") {
      return false;
    }

    // Look for Transfer event from the token contract
    const events: Array<{ from_address: string; data: string[] }> = receipt.events ?? [];
    const transferEvents = events.filter(
      (e) => num.toHex(e.from_address) === num.toHex(tokenAddress),
    );

    for (const event of transferEvents) {
      // ERC20 Transfer event: [from, to, amount_low, amount_high]
      if (event.data && event.data.length >= 4) {
        const to = num.toHex(event.data[1]);
        const amountLow = BigInt(event.data[2]);
        const amountHigh = BigInt(event.data[3]);
        const amount = amountLow + (amountHigh << 128n);

        if (
          num.toHex(to) === num.toHex(expectedRecipient) &&
          amount >= expectedAmount
        ) {
          return true;
        }
      }
    }
    return false;
  });
}

export async function getERC20Balance(
  tokenAddress: string,
  accountAddress: string,
): Promise<bigint> {
  return withRetry(async () => {
    const result = await provider.callContract({
      contractAddress: tokenAddress,
      entrypoint: "balance_of",
      calldata: CallData.compile({ account: accountAddress }),
    });
    const low = BigInt(result[0]);
    const high = BigInt(result[1]);
    return low + (high << 128n);
  });
}

// --- Bridge: transfer, marketplace whitelist ---

export async function transferTicket(
  contractAddress: string,
  fromAddress: string,
  toAddress: string,
  tokenId: bigint,
  salePrice: bigint = 0n
): Promise<string> {
  return withRetry(async () => {
    const result = await account.execute({
      contractAddress,
      entrypoint: "transfer_ticket",
      calldata: CallData.compile({
        from: fromAddress,
        to: toAddress,
        token_id: { low: tokenId & BigInt("0xFFFFFFFFFFFFFFFF"), high: tokenId >> 128n },
        sale_price: salePrice,
      }),
    });
    await withTimeout(
      provider.waitForTransaction(result.transaction_hash),
      TX_TIMEOUT_MS
    );
    return result.transaction_hash;
  });
}

export async function addMarketplace(
  contractAddress: string,
  marketplaceAddress: string
): Promise<string> {
  return withRetry(async () => {
    const result = await account.execute({
      contractAddress,
      entrypoint: "add_marketplace",
      calldata: CallData.compile({
        marketplace: marketplaceAddress,
      }),
    });
    await withTimeout(
      provider.waitForTransaction(result.transaction_hash),
      TX_TIMEOUT_MS
    );
    return result.transaction_hash;
  });
}

export async function isMarketplaceAllowed(
  contractAddress: string,
  marketplaceAddress: string
): Promise<boolean> {
  return withRetry(async () => {
    const result = await provider.callContract({
      contractAddress,
      entrypoint: "is_marketplace_allowed",
      calldata: CallData.compile({
        marketplace: marketplaceAddress,
      }),
    });
    return result[0] !== "0x0";
  });
}

export { provider, account };
