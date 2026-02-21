/**
 * Deploy script for Starknet NFT Ticketing contracts.
 * Usage: npx tsx deploy/deploy.ts
 *
 * Declares and deploys: EventTicket (class only), Marketplace, Paymaster, TicketFactory
 * Outputs: deployments.json + .env values
 */

import { RpcProvider, Account, json, CallData } from "starknet";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const RPC_URL = process.env.STARKNET_RPC_URL || "http://127.0.0.1:5050";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS || "";
const NETWORK = process.env.STARKNET_NETWORK || "devnet";

// STRK token address (same on Sepolia and devnet)
const STRK_ADDRESS =
  "0x04718F5A0FC34CC1AF16A1CDEE98FFB20C31F5CD61D6AB07201858F4287C938D";

const CONTRACTS_DIR = path.join(__dirname, "..", "contracts", "target", "dev");
const DEPLOYMENTS_FILE = path.join(__dirname, "deployments.json");

const STARKSCAN_URL =
  NETWORK === "sepolia"
    ? "https://sepolia.starkscan.co"
    : NETWORK === "mainnet"
      ? "https://starkscan.co"
      : null;

function readContract(name: string) {
  const sierra = json.parse(
    fs.readFileSync(
      path.join(CONTRACTS_DIR, `${name}.contract_class.json`),
      "utf-8"
    )
  );
  const casm = json.parse(
    fs.readFileSync(
      path.join(CONTRACTS_DIR, `${name}.compiled_contract_class.json`),
      "utf-8"
    )
  );
  return { sierra, casm };
}

async function declareContract(
  account: Account,
  name: string,
  label: string
): Promise<string> {
  console.log(`\n--- Declaring ${label} ---`);
  const { sierra, casm } = readContract(name);

  const declareResponse = await account.declare({ contract: sierra, casm });
  console.log(`  tx: ${declareResponse.transaction_hash}`);
  await account.waitForTransaction(declareResponse.transaction_hash);
  console.log(`  class_hash: ${declareResponse.class_hash}`);
  return declareResponse.class_hash;
}

async function deployContract(
  account: Account,
  classHash: string,
  constructorCalldata: any[],
  label: string
): Promise<string> {
  console.log(`\n--- Deploying ${label} ---`);

  const deployResponse = await account.deployContract({
    classHash,
    constructorCalldata,
  });
  console.log(`  tx: ${deployResponse.transaction_hash}`);
  await account.waitForTransaction(deployResponse.transaction_hash);
  const address = deployResponse.contract_address!;
  console.log(`  address: ${address}`);
  if (STARKSCAN_URL) {
    console.log(`  -> ${STARKSCAN_URL}/contract/${address}`);
  }
  return address;
}

async function main() {
  console.log(`Deploying to Starknet ${NETWORK}...`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Deployer: ${DEPLOYER_ADDRESS}`);

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const account = new Account({
    provider,
    address: DEPLOYER_ADDRESS,
    signer: DEPLOYER_PRIVATE_KEY,
  });

  const deployments: Record<string, string> = {};

  // 1. Declare EventTicket (class only, TicketFactory deploys instances)
  const ticketClassHash = await declareContract(
    account,
    "starknet_nft_ticketing_EventTicket",
    "EventTicket"
  );
  deployments.ticket_class_hash = ticketClassHash;

  // 2. Declare + Deploy Marketplace
  const marketplaceClassHash = await declareContract(
    account,
    "starknet_nft_ticketing_Marketplace",
    "Marketplace"
  );
  // Marketplace constructor: owner, payment_token, platform_fee_bps (u256), platform_treasury
  const marketplaceAddress = await deployContract(
    account,
    marketplaceClassHash,
    [
      DEPLOYER_ADDRESS,        // owner
      STRK_ADDRESS,            // payment_token
      "200", "0",              // platform_fee_bps u256 (low=200, high=0) = 2%
      DEPLOYER_ADDRESS,        // platform_treasury
    ],
    "Marketplace"
  );
  deployments.marketplace_address = marketplaceAddress;

  // 3. Declare + Deploy Paymaster
  const paymasterClassHash = await declareContract(
    account,
    "starknet_nft_ticketing_Paymaster",
    "Paymaster"
  );
  // Paymaster constructor: owner, strk_token, max_gas_per_tx (u256), daily_limit (u256)
  const paymasterAddress = await deployContract(
    account,
    paymasterClassHash,
    [
      DEPLOYER_ADDRESS,        // owner
      STRK_ADDRESS,            // strk_token
      "500000", "0",           // max_gas_per_tx u256
      "50000000", "0",         // daily_limit u256
    ],
    "Paymaster"
  );
  deployments.paymaster_address = paymasterAddress;

  // 4. Declare + Deploy TicketFactory
  const factoryClassHash = await declareContract(
    account,
    "starknet_nft_ticketing_TicketFactory",
    "TicketFactory"
  );
  // TicketFactory constructor: ticket_class_hash (ClassHash), owner
  const factoryAddress = await deployContract(
    account,
    factoryClassHash,
    [
      ticketClassHash,         // ticket_class_hash
      DEPLOYER_ADDRESS,        // owner
    ],
    "TicketFactory"
  );
  deployments.factory_address = factoryAddress;

  // 5. Save deployments
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
  console.log(`\nDeployments saved to ${DEPLOYMENTS_FILE}`);

  // 6. Print .env update
  console.log("\n--- Add to .env ---");
  console.log(`FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`MARKETPLACE_ADDRESS=${marketplaceAddress}`);
  console.log(`PAYMASTER_ADDRESS=${paymasterAddress}`);

  console.log("\nDeployment complete!");
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
