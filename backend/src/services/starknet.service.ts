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

export { provider, account };
