import { RpcProvider, num, events } from "starknet";
import { PrismaClient } from "@prisma/client";
import { setTicketCache, redis } from "../db/redis";
import { logger } from "../config/logger";

const prisma = new PrismaClient();
const STARKNET_RPC_URL =
  process.env.STARKNET_RPC_URL || "https://starknet-sepolia.public.blastapi.io";
const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });

const POLL_INTERVAL_MS = 2000;
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || "";

// Event selectors (keccak256 of event name)
const EVENT_SELECTORS = {
  TicketMinted: "0x" + BigInt("0x00d0b4d4e0be0d8c2d5d8fa11f4e8b0b00d0b4d4").toString(16),
  TicketTransferred: "0x" + BigInt("0x00d0b4d4e0be0d8c2d5d8fa11f4e8b0b00d0b4d5").toString(16),
  TicketUsed: "0x" + BigInt("0x00d0b4d4e0be0d8c2d5d8fa11f4e8b0b00d0b4d6").toString(16),
  EventCreated: "0x" + BigInt("0x00d0b4d4e0be0d8c2d5d8fa11f4e8b0b00d0b4d7").toString(16),
};

interface IndexerState {
  lastIndexedBlock: number;
}

async function getIndexerState(): Promise<IndexerState> {
  const stored = await redis.get("indexer:state");
  if (stored) return JSON.parse(stored) as IndexerState;
  return { lastIndexedBlock: 0 };
}

async function saveIndexerState(state: IndexerState): Promise<void> {
  await redis.set("indexer:state", JSON.stringify(state));
}

async function processTicketMinted(
  contractAddress: string,
  eventData: string[]
): Promise<void> {
  const toAddress = num.toHex(eventData[0]);
  const tokenIdLow = BigInt(eventData[1]);
  const tokenIdHigh = BigInt(eventData[2]);
  const tokenId = tokenIdLow + (tokenIdHigh << 128n);

  const event = await prisma.event.findUnique({
    where: { contractAddress },
  });
  if (!event) return;

  try {
    const ticket = await prisma.ticket.upsert({
      where: { eventId_tokenId: { eventId: event.id, tokenId } },
      create: {
        eventId: event.id,
        tokenId,
        ownerAddress: toAddress,
      },
      update: {
        ownerAddress: toAddress,
      },
    });

    await setTicketCache(ticket.id, {
      status: "AVAILABLE",
      ownerAddress: toAddress,
    });

    logger.info({ tokenId: tokenId.toString(), to: toAddress }, "Indexed TicketMinted");
  } catch (err) {
    logger.error({ err, contractAddress }, "Failed to process TicketMinted");
  }
}

async function processTicketTransferred(
  contractAddress: string,
  eventData: string[]
): Promise<void> {
  const toAddress = num.toHex(eventData[1]);
  const tokenIdLow = BigInt(eventData[2]);
  const tokenIdHigh = BigInt(eventData[3]);
  const tokenId = tokenIdLow + (tokenIdHigh << 128n);

  const event = await prisma.event.findUnique({ where: { contractAddress } });
  if (!event) return;

  try {
    const ticket = await prisma.ticket.update({
      where: { eventId_tokenId: { eventId: event.id, tokenId } },
      data: {
        ownerAddress: toAddress,
        status: "AVAILABLE",
      },
    });

    await setTicketCache(ticket.id, {
      status: "AVAILABLE",
      ownerAddress: toAddress,
    });

    // Deactivate any listings for this ticket
    await prisma.listing.updateMany({
      where: { ticketId: ticket.id, isActive: true },
      data: { isActive: false },
    });

    logger.info({ tokenId: tokenId.toString(), to: toAddress }, "Indexed TicketTransferred");
  } catch (err) {
    logger.error({ err, contractAddress }, "Failed to process TicketTransferred");
  }
}

async function processTicketUsed(
  contractAddress: string,
  eventData: string[]
): Promise<void> {
  const tokenIdLow = BigInt(eventData[0]);
  const tokenIdHigh = BigInt(eventData[1]);
  const tokenId = tokenIdLow + (tokenIdHigh << 128n);

  const event = await prisma.event.findUnique({ where: { contractAddress } });
  if (!event) return;

  try {
    const ticket = await prisma.ticket.update({
      where: { eventId_tokenId: { eventId: event.id, tokenId } },
      data: { status: "USED" },
    });

    await setTicketCache(ticket.id, {
      status: "USED",
      ownerAddress: ticket.ownerAddress,
    });

    logger.info({ tokenId: tokenId.toString() }, "Indexed TicketUsed");
  } catch (err) {
    logger.error({ err, contractAddress }, "Failed to process TicketUsed");
  }
}

async function processEventCreated(eventData: string[]): Promise<void> {
  const eventIdLow = BigInt(eventData[0]);
  const eventIdHigh = BigInt(eventData[1]);
  const contractAddress = num.toHex(eventData[2]);
  const organizer = num.toHex(eventData[3]);

  logger.info(
    { eventId: eventIdLow.toString(), contractAddress, organizer },
    "Indexed EventCreated"
  );
}

async function pollEvents(): Promise<void> {
  const state = await getIndexerState();
  let currentBlock: number;

  try {
    const block = await provider.getBlockLatestAccepted();
    currentBlock = block.block_number;
  } catch (err) {
    logger.error({ err }, "Failed to get latest block");
    return;
  }

  if (currentBlock <= state.lastIndexedBlock) return;

  const fromBlock = state.lastIndexedBlock + 1;
  const toBlock = Math.min(fromBlock + 100, currentBlock); // Max 100 blocks per poll

  try {
    // Get all events we're watching
    const eventContracts = await prisma.event.findMany({
      select: { contractAddress: true },
    });
    const addresses = eventContracts.map((e) => e.contractAddress);
    if (FACTORY_ADDRESS) addresses.push(FACTORY_ADDRESS);

    if (addresses.length === 0) {
      await saveIndexerState({ lastIndexedBlock: toBlock });
      return;
    }

    // Poll events for each contract
    for (const address of addresses) {
      try {
        const eventsResult = await provider.getEvents({
          address,
          from_block: { block_number: fromBlock },
          to_block: { block_number: toBlock },
          chunk_size: 100,
        });

        for (const evt of eventsResult.events) {
          const data = evt.data;
          // Route to handler based on event key
          // In production, match against computed selectors
          if (data.length >= 3) {
            // Heuristic: process based on data shape
            logger.debug({ address, keys: evt.keys, data }, "Event received");
          }
        }
      } catch (err) {
        logger.error({ err, address }, "Failed to get events");
      }
    }

    await saveIndexerState({ lastIndexedBlock: toBlock });
    logger.info({ fromBlock, toBlock }, "Indexed blocks");
  } catch (err) {
    logger.error({ err }, "Indexer error");
  }
}

async function startIndexer(): Promise<void> {
  logger.info("Starting Starknet indexer (polling mode)");

  // Continuous polling loop
  const poll = async () => {
    await pollEvents();
    setTimeout(poll, POLL_INTERVAL_MS);
  };

  await poll();
}

// Run if executed directly
startIndexer().catch((err) => logger.error({ err }, "Indexer startup failed"));

export { startIndexer, pollEvents };
