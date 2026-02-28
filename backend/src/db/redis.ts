import IORedis from "ioredis";
import { logger } from "../config/logger";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Parse URL for BullMQ connection config (including auth if present)
const redisUrl = new URL(REDIS_URL);
export const bullmqConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
  ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
  ...(redisUrl.username && redisUrl.username !== "" ? { username: decodeURIComponent(redisUrl.username) } : {}),
};

export const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    return Math.min(times * 200, 2000);
  },
});

redis.on("error", (err: Error) => {
  logger.error({ err: err.message }, "Redis connection error");
});

export async function getTicketCache(
  ticketId: string
): Promise<{ status: string; ownerAddress: string; ownerName?: string } | null> {
  const data = await redis.get(`ticket:${ticketId}`);
  if (!data) return null;
  return JSON.parse(data) as {
    status: string;
    ownerAddress: string;
    ownerName?: string;
  };
}

export async function setTicketCache(
  ticketId: string,
  data: { status: string; ownerAddress: string; ownerName?: string }
): Promise<void> {
  await redis.set(`ticket:${ticketId}`, JSON.stringify(data), "EX", 3600);
}

export async function markTicketUsedAtomic(
  ticketId: string
): Promise<boolean> {
  // SECURITY FIX (MED-01): Use atomic SET EX NX instead of SETNX + EXPIRE
  const result = await redis.set(
    `ticket_used:${ticketId}`,
    Date.now().toString(),
    "EX",
    604800, // 7 days TTL (instead of 24h — prevents post-expiry rescan)
    "NX"
  );
  return result === "OK";
}

// Atomic token ID allocation per event (CRIT-03 fix)
export async function allocateTokenId(eventId: string): Promise<bigint> {
  const counter = await redis.incr(`event_token_counter:${eventId}`);
  return BigInt(counter);
}

// Initialize token counter for an event (call during event creation or on first mint)
export async function initTokenCounter(eventId: string, currentCount: number): Promise<void> {
  // Only set if not already set (NX) to avoid overwriting a live counter
  await redis.set(`event_token_counter:${eventId}`, currentCount.toString(), "NX");
}
