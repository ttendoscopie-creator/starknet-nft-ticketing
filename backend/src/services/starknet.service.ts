import { RpcProvider, Account, Contract, CallData, num } from "starknet";

const STARKNET_RPC_URL =
  process.env.STARKNET_RPC_URL || "https://starknet-sepolia.public.blastapi.io";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS || "";

const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });
const account = new Account(provider, DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY);

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES - 1) {
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
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
    await provider.waitForTransaction(result.transaction_hash);
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
    await provider.waitForTransaction(result.transaction_hash);
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
    await provider.waitForTransaction(result.transaction_hash);
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

export { provider, account };
