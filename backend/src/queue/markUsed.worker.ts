import { Worker, Job } from "bullmq";
import { prisma } from "../db/prisma";
import { markUsedBatch } from "../services/starknet.service";
import { bullmqConnection, redis } from "../db/redis";
import { logger } from "../config/logger";

interface MarkUsedJobData {
  ticketId: string;
}

// SECURITY FIX (HIGH-16): Use Redis-based batch instead of in-memory Map
// In-memory state is lost on worker crash/restart, causing tickets to never be marked used on-chain
const BATCH_INTERVAL_MS = 5000;
const BATCH_SIZE = 50;
const REDIS_BATCH_KEY = "markUsed:pending";
let batchTimer: ReturnType<typeof setTimeout> | null = null;

async function addToBatch(ticketId: string, contractAddress: string, tokenId: bigint): Promise<number> {
  const entry = JSON.stringify({ ticketId, contractAddress, tokenId: tokenId.toString() });
  await redis.hset(REDIS_BATCH_KEY, ticketId, entry);
  return await redis.hlen(REDIS_BATCH_KEY);
}

async function flushBatch(): Promise<void> {
  // Atomically get and clear all pending entries
  const entries = await redis.hgetall(REDIS_BATCH_KEY);
  const keys = Object.keys(entries);
  if (keys.length === 0) return;

  // Delete fetched keys from Redis
  await redis.hdel(REDIS_BATCH_KEY, ...keys);

  // Group by contract address
  const grouped = new Map<string, bigint[]>();
  for (const raw of Object.values(entries)) {
    const { contractAddress, tokenId } = JSON.parse(raw);
    const existing = grouped.get(contractAddress) || [];
    existing.push(BigInt(tokenId));
    grouped.set(contractAddress, existing);
  }

  for (const [contractAddress, tokenIds] of grouped) {
    try {
      const txHash = await markUsedBatch(contractAddress, tokenIds);
      logger.info(
        { contractAddress, count: tokenIds.length, txHash },
        "Batch mark_used completed"
      );

      // Update scan logs sync status
      await prisma.scanLog.updateMany({
        where: {
          ticket: {
            event: { contractAddress },
            tokenId: { in: tokenIds },
          },
          syncStatus: "PENDING",
        },
        data: { syncStatus: "SYNCED" },
      });
    } catch (err) {
      // Re-add failed entries back to Redis for retry
      for (const tokenId of tokenIds) {
        const entry = JSON.stringify({ contractAddress, tokenId: tokenId.toString() });
        await redis.hset(REDIS_BATCH_KEY, `${contractAddress}:${tokenId}`, entry);
      }
      logger.error({ err, contractAddress }, "Batch mark_used failed, re-queued");
    }
  }
}

const markUsedWorker = new Worker<MarkUsedJobData>(
  "markUsed",
  async (job: Job<MarkUsedJobData>) => {
    const { ticketId } = job.data;

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { event: true },
    });
    if (!ticket) return;

    const batchSize = await addToBatch(
      ticketId,
      ticket.event.contractAddress,
      ticket.tokenId
    );

    // Flush when batch is full
    if (batchSize >= BATCH_SIZE) {
      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }
      await flushBatch();
    } else if (!batchTimer) {
      // Start timer for partial batch
      batchTimer = setTimeout(async () => {
        batchTimer = null;
        await flushBatch();
      }, BATCH_INTERVAL_MS);
    }
  },
  {
    connection: bullmqConnection,
    concurrency: 1, // Single consumer for batching
  }
);

markUsedWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "markUsed job failed");
});

// Flush any orphaned entries from previous crash on startup
flushBatch().catch((err) => logger.error({ err }, "Startup flush failed"));

export { markUsedWorker };
