/**
 * Demo script: Full lifecycle test
 * Usage: npx tsx deploy/demo.ts
 *
 * 1. Reads deployment addresses from deployments.json
 * 2. Mints a ticket
 * 3. Marks it as used
 * 4. Verifies is_used == true
 */

import { RpcProvider, Account, Contract, CallData, num } from "starknet";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const RPC_URL =
  process.env.STARKNET_RPC_URL || "https://starknet-sepolia.public.blastapi.io";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS || "";

interface Deployments {
  factory_address: string;
  marketplace_address: string;
  paymaster_address: string;
  ticket_class_hash: string;
}

async function main() {
  console.log("=== NFT Ticketing Demo ===\n");

  // Read deployments
  const deploymentsPath = path.join(__dirname, "deployments.json");
  if (!fs.existsSync(deploymentsPath)) {
    console.error("deployments.json not found. Run deploy.py first.");
    process.exit(1);
  }
  const deployments: Deployments = JSON.parse(
    fs.readFileSync(deploymentsPath, "utf-8")
  );

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const account = new Account(provider, DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY);

  console.log(`Provider: ${RPC_URL}`);
  console.log(`Account: ${DEPLOYER_ADDRESS}`);
  console.log(`Factory: ${deployments.factory_address}\n`);

  // Step 1: Create event via TicketFactory
  console.log("--- Step 1: Create Event ---");
  const createEventResult = await account.execute({
    contractAddress: deployments.factory_address,
    entrypoint: "create_event",
    calldata: CallData.compile({
      max_supply: { low: 100, high: 0 },
      primary_price: { low: 1000000, high: 0 },
      resale_cap_bps: { low: 11000, high: 0 },
      royalty_bps: { low: 1000, high: 0 },
      marketplace: deployments.marketplace_address,
    }),
  });
  await provider.waitForTransaction(createEventResult.transaction_hash);
  console.log(`Create event tx: ${createEventResult.transaction_hash}`);

  // Get the event contract address
  const eventCountResult = await provider.callContract({
    contractAddress: deployments.factory_address,
    entrypoint: "get_event_count",
  });
  const eventCount = Number(eventCountResult[0]);
  console.log(`Total events: ${eventCount}`);

  const eventContractResult = await provider.callContract({
    contractAddress: deployments.factory_address,
    entrypoint: "get_event_contract",
    calldata: CallData.compile({ event_id: { low: eventCount - 1, high: 0 } }),
  });
  const eventContractAddress = num.toHex(eventContractResult[0]);
  console.log(`Event contract: ${eventContractAddress}\n`);

  // Step 2: Mint ticket
  console.log("--- Step 2: Mint Ticket ---");
  const mintResult = await account.execute({
    contractAddress: eventContractAddress,
    entrypoint: "mint",
    calldata: CallData.compile({
      to: DEPLOYER_ADDRESS,
      token_id: { low: 1, high: 0 },
    }),
  });
  await provider.waitForTransaction(mintResult.transaction_hash);
  console.log(`Mint tx: ${mintResult.transaction_hash}`);

  // Verify owner
  const ownerResult = await provider.callContract({
    contractAddress: eventContractAddress,
    entrypoint: "owner_of",
    calldata: CallData.compile({ token_id: { low: 1, high: 0 } }),
  });
  console.log(`Owner: ${num.toHex(ownerResult[0])}`);

  // Check not used
  const usedBefore = await provider.callContract({
    contractAddress: eventContractAddress,
    entrypoint: "is_used",
    calldata: CallData.compile({ token_id: { low: 1, high: 0 } }),
  });
  console.log(`is_used (before): ${usedBefore[0] !== "0x0"}\n`);

  // Step 3: Add deployer as staff, then mark_used
  console.log("--- Step 3: Mark Used ---");
  const addStaffResult = await account.execute({
    contractAddress: eventContractAddress,
    entrypoint: "add_staff",
    calldata: CallData.compile({ account: DEPLOYER_ADDRESS }),
  });
  await provider.waitForTransaction(addStaffResult.transaction_hash);
  console.log(`Add staff tx: ${addStaffResult.transaction_hash}`);

  const markUsedResult = await account.execute({
    contractAddress: eventContractAddress,
    entrypoint: "mark_used",
    calldata: CallData.compile({ token_id: { low: 1, high: 0 } }),
  });
  await provider.waitForTransaction(markUsedResult.transaction_hash);
  console.log(`Mark used tx: ${markUsedResult.transaction_hash}`);

  // Step 4: Verify is_used == true
  const usedAfter = await provider.callContract({
    contractAddress: eventContractAddress,
    entrypoint: "is_used",
    calldata: CallData.compile({ token_id: { low: 1, high: 0 } }),
  });
  const isUsed = usedAfter[0] !== "0x0";
  console.log(`is_used (after): ${isUsed}\n`);

  if (isUsed) {
    console.log("=== Demo PASSED: Full lifecycle mint -> mark_used -> is_used=true ===");
  } else {
    console.error("=== Demo FAILED: is_used should be true ===");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
