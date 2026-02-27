import IORedis from "ioredis";
import { logger } from "../config/logger";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Parse URL for BullMQ connection config (avoids ioredis version mismatch with bullmq)
const redisUrl = new URL(REDIS_URL);
export const bullmqConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
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
  // SETNX returns 1 if key was set (first scan), 0 if already exists (double scan)
  const result = await redis.setnx(`ticket_used:${ticketId}`, Date.now().toString());
  if (result === 1) {
    await redis.expire(`ticket_used:${ticketId}`, 86400);
    return true;
  }
  return false;
}
