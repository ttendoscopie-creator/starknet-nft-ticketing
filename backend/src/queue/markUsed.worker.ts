import { Worker, Job } from "bullmq";
import { prisma } from "../db/prisma";
import { markUsedBatch } from "../services/starknet.service";
import { bullmqConnection } from "../db/redis";
import { logger } from "../config/logger";

interface MarkUsedJobData {
  ticketId: string;
}

// Batch mark_used calls for gas efficiency
const pendingTokenIds: Map<string, { contractAddress: string; tokenId: bigint }> = new Map();
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_INTERVAL_MS = 5000;
const BATCH_SIZE = 50;

async function flushBatch(): Promise<void> {
  if (pendingTokenIds.size === 0) return;

  // Group by contract address
  const grouped = new Map<string, bigint[]>();
  for (const [, { contractAddress, tokenId }] of pendingTokenIds) {
    const existing = grouped.get(contractAddress) || [];
    existing.push(tokenId);
    grouped.set(contractAddress, existing);
  }
  pendingTokenIds.clear();

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
      logger.error({ err, contractAddress }, "Batch mark_used failed");
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

    pendingTokenIds.set(ticketId, {
      contractAddress: ticket.event.contractAddress,
      tokenId: ticket.tokenId,
    });

    // Flush when batch is full
    if (pendingTokenIds.size >= BATCH_SIZE) {
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

export { markUsedWorker };
