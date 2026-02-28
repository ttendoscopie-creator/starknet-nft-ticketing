import { Worker, Queue, Job } from "bullmq";
import { prisma } from "../db/prisma";
import {
  mintTicket,
  transferTicket,
  addMarketplace,
  isMarketplaceAllowed,
} from "../services/starknet.service";
import { setTicketCache, bullmqConnection, redis, allocateTokenId, initTokenCounter } from "../db/redis";
import { logger } from "../config/logger";

const VAULT_ADDRESS = process.env.VAULT_ADDRESS || process.env.DEPLOYER_ADDRESS!;

// --- Queues ---

export const bridgeMintQueue = new Queue("bridgeMint", {
  connection: bullmqConnection,
  defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 2000 } },
});

export const bridgeClaimQueue = new Queue("bridgeClaim", {
  connection: bullmqConnection,
  defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 2000 } },
});

// --- Job interfaces ---

export interface BridgeMintJobData {
  bridgedTicketId: string;
  eventId: string;
  ownerEmail: string;
}

export interface BridgeClaimJobData {
  bridgedTicketId: string;
  toAddress: string;
}

// --- Bridge Mint Worker ---

const bridgeMintWorker = new Worker<BridgeMintJobData>(
  "bridgeMint",
  async (job: Job<BridgeMintJobData>) => {
    const { bridgedTicketId, eventId, ownerEmail } = job.data;

    const bridgedTicket = await prisma.bridgedTicket.findUnique({
      where: { id: bridgedTicketId },
    });
    if (!bridgedTicket || bridgedTicket.status !== "PENDING") {
      logger.info({ bridgedTicketId, status: bridgedTicket?.status }, "Skipping non-PENDING bridge ticket");
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: { _count: { select: { tickets: true } } },
    });
    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }

    if (event.contractAddress === "0x0") {
      throw new Error(`Event ${eventId} contract not deployed yet`);
    }

    if (event.isSoulbound) {
      await prisma.bridgedTicket.update({
        where: { id: bridgedTicketId },
        data: { status: "FAILED", errorMessage: "Soulbound tickets cannot be bridged (transfer blocked)" },
      });
      throw new Error(`Event ${eventId} has soulbound tickets — bridge mint rejected`);
    }

    if (event._count.tickets >= event.maxSupply) {
      await prisma.bridgedTicket.update({
        where: { id: bridgedTicketId },
        data: { status: "FAILED", errorMessage: "Max supply reached" },
      });
      throw new Error(`Event ${eventId} max supply (${event.maxSupply}) reached`);
    }

    // SECURITY FIX (CRIT-03): Atomic tokenId allocation via Redis INCR
    await initTokenCounter(eventId, event._count.tickets);
    const tokenId = await allocateTokenId(eventId);

    // Double-check supply limit
    if (tokenId > BigInt(event.maxSupply)) {
      await prisma.bridgedTicket.update({
        where: { id: bridgedTicketId },
        data: { status: "FAILED", errorMessage: "Max supply reached" },
      });
      throw new Error(`Event ${eventId} max supply (${event.maxSupply}) reached`);
    }

    try {
      const txHash = await mintTicket(event.contractAddress, VAULT_ADDRESS, tokenId);

      const ticket = await prisma.ticket.create({
        data: {
          eventId,
          tokenId,
          ownerAddress: VAULT_ADDRESS,
          ownerEmail,
          lastTransactionHash: txHash,
        },
      });

      await prisma.bridgedTicket.update({
        where: { id: bridgedTicketId },
        data: {
          status: "MINTED",
          tokenId,
          ticketId: ticket.id,
          vaultAddress: VAULT_ADDRESS,
          mintTxHash: txHash,
        },
      });

      await setTicketCache(ticket.id, {
        status: "AVAILABLE",
        ownerAddress: VAULT_ADDRESS,
        ownerName: ownerEmail,
      });

      logger.info(
        { bridgedTicketId, ticketId: ticket.id, tokenId: tokenId.toString(), ownerEmail },
        "Bridge ticket minted to vault"
      );
    } catch (err) {
      await prisma.bridgedTicket.update({
        where: { id: bridgedTicketId },
        data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err) },
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

bridgeMintWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "Bridge mint job failed");
});

bridgeMintWorker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Bridge mint job completed");
});

// --- Bridge Claim Worker ---

const MARKETPLACE_CACHE_KEY = "bridge:marketplace_setup:";
const MARKETPLACE_CACHE_TTL = 86400; // 24h

async function ensureMarketplaceWhitelisted(contractAddress: string): Promise<void> {
  const cacheKey = `${MARKETPLACE_CACHE_KEY}${contractAddress}`;
  const cached = await redis.get(cacheKey);
  if (cached === "1") return;

  const allowed = await isMarketplaceAllowed(contractAddress, VAULT_ADDRESS);
  if (!allowed) {
    logger.info({ contractAddress, vaultAddress: VAULT_ADDRESS }, "Whitelisting vault as marketplace");
    await addMarketplace(contractAddress, VAULT_ADDRESS);
  }

  await redis.set(cacheKey, "1", "EX", MARKETPLACE_CACHE_TTL);
}

const bridgeClaimWorker = new Worker<BridgeClaimJobData>(
  "bridgeClaim",
  async (job: Job<BridgeClaimJobData>) => {
    const { bridgedTicketId, toAddress } = job.data;

    const bridgedTicket = await prisma.bridgedTicket.findUnique({
      where: { id: bridgedTicketId },
      include: { ticket: true, event: true },
    });

    // SECURITY FIX (HIGH-03): Accept CLAIMING status (set atomically by claim route)
    if (!bridgedTicket || (bridgedTicket.status !== "MINTED" && bridgedTicket.status !== "CLAIMING")) {
      logger.info({ bridgedTicketId, status: bridgedTicket?.status }, "Skipping bridge ticket not ready for claim");
      return;
    }

    if (!bridgedTicket.ticket || !bridgedTicket.event) {
      throw new Error(`Bridge ticket ${bridgedTicketId} missing ticket or event relation`);
    }

    if (bridgedTicket.ticket.status === "USED" || bridgedTicket.ticket.status === "REVOKED") {
      await prisma.bridgedTicket.update({
        where: { id: bridgedTicketId },
        data: { status: "FAILED", errorMessage: `Ticket is ${bridgedTicket.ticket.status}` },
      });
      return;
    }

    const tokenId = bridgedTicket.tokenId!;
    const contractAddress = bridgedTicket.event.contractAddress;

    try {
      await ensureMarketplaceWhitelisted(contractAddress);

      const txHash = await transferTicket(
        contractAddress,
        VAULT_ADDRESS,
        toAddress,
        tokenId,
        0n // free claim, no sale price
      );

      await prisma.ticket.update({
        where: { id: bridgedTicket.ticketId! },
        data: { ownerAddress: toAddress, lastTransactionHash: txHash },
      });

      await prisma.bridgedTicket.update({
        where: { id: bridgedTicketId },
        data: {
          status: "CLAIMED",
          claimedByAddress: toAddress,
          claimTxHash: txHash,
        },
      });

      await setTicketCache(bridgedTicket.ticketId!, {
        status: "AVAILABLE",
        ownerAddress: toAddress,
        ownerName: bridgedTicket.ownerEmail,
      });

      logger.info(
        { bridgedTicketId, ticketId: bridgedTicket.ticketId, toAddress },
        "Bridge ticket claimed"
      );
    } catch (err) {
      await prisma.bridgedTicket.update({
        where: { id: bridgedTicketId },
        data: { errorMessage: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  },
  {
    connection: bullmqConnection,
    concurrency: 3,
    limiter: { max: 5, duration: 1000 },
  }
);

bridgeClaimWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "Bridge claim job failed");
});

bridgeClaimWorker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Bridge claim job completed");
});

export { bridgeMintWorker, bridgeClaimWorker };
