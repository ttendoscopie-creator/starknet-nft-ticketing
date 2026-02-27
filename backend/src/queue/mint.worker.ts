import { Worker, Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { mintTicket } from "../services/starknet.service";
import { setTicketCache, bullmqConnection } from "../db/redis";
import { logger } from "../config/logger";

const prisma = new PrismaClient();

interface MintJobData {
  pendingMintId: string;
  eventId: string;
  buyerEmail: string;
  buyerWalletAddress?: string;
}

const mintWorker = new Worker<MintJobData>(
  "mint",
  async (job: Job<MintJobData>) => {
    const { pendingMintId, eventId, buyerEmail, buyerWalletAddress } = job.data;

    const pendingMint = await prisma.pendingMint.findUnique({
      where: { id: pendingMintId },
    });
    if (!pendingMint || pendingMint.status !== "PENDING") {
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { _count: { select: { tickets: true } } },
    });
    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }

    if (event._count.tickets >= event.maxSupply) {
      await prisma.pendingMint.update({
        where: { id: pendingMintId },
        data: { status: "FAILED" },
      });
      throw new Error(`Event ${eventId} max supply (${event.maxSupply}) reached`);
    }

    const tokenId = BigInt(event._count.tickets + 1);
    const walletAddress = buyerWalletAddress || "0x0"; // Placeholder if no wallet yet

    try {
      // Mint on-chain
      const txHash = await mintTicket(event.contractAddress, walletAddress, tokenId);

      // Create ticket in DB
      const ticket = await prisma.ticket.create({
        data: {
          eventId,
          tokenId,
          ownerAddress: walletAddress,
          ownerEmail: buyerEmail,
          lastTransactionHash: txHash,
        },
      });

      // Update pending mint status
      await prisma.pendingMint.update({
        where: { id: pendingMintId },
        data: { status: "MINTED", txHash },
      });

      // Cache ticket
      await setTicketCache(ticket.id, {
        status: "AVAILABLE",
        ownerAddress: walletAddress,
        ownerName: buyerEmail,
      });

      logger.info({ ticketId: ticket.id, tokenId: tokenId.toString(), buyerEmail }, "Minted ticket");
    } catch (err) {
      await prisma.pendingMint.update({
        where: { id: pendingMintId },
        data: { status: "FAILED" },
      });
      throw err;
    }
  },
  {
    connection: bullmqConnection,
    concurrency: 5,
    limiter: { max: 10, duration: 1000 },
  }
);

mintWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "Mint job failed");
});

mintWorker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Mint job completed");
});

export { mintWorker };
