#!/usr/bin/env python3
"""
Deploy script for Starknet NFT Ticketing contracts.
Requires: starknet.py >= 0.22, Python 3.10+
Usage: python deploy/deploy.py
"""

import asyncio
import json
import os
from pathlib import Path
from dotenv import load_dotenv

from starknet_py.net.full_node_client import FullNodeClient
from starknet_py.net.account.account import Account
from starknet_py.net.models.chains import StarknetChainId
from starknet_py.net.signer.stark_curve_signer import KeyPair
from starknet_py.contract import Contract
from starknet_py.common import create_compiled_contract

load_dotenv()


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"ERROR: Missing required env var: {name}")
    return value


RPC_URL = require_env("STARKNET_RPC_URL")
DEPLOYER_PRIVATE_KEY = int(require_env("DEPLOYER_PRIVATE_KEY"), 16)
DEPLOYER_ADDRESS = int(require_env("DEPLOYER_ADDRESS"), 16)
NETWORK = os.getenv("STARKNET_NETWORK", "sepolia")

# STRK token on Sepolia
STRK_ADDRESS = 0x04718F5A0FC34CC1AF16A1CDEE98FFB20C31F5CD61D6AB07201858F4287C938D

CONTRACTS_DIR = Path(__file__).parent.parent / "contracts" / "target" / "dev"
DEPLOYMENTS_FILE = Path(__file__).parent / "deployments.json"

CHAIN_ID = StarknetChainId.SEPOLIA

STARKSCAN_URL = (
    "https://sepolia.starkscan.co" if NETWORK == "sepolia" else "https://starkscan.co"
)


async def main():
    print(f"Deploying to Starknet {NETWORK}...")
    print(f"RPC: {RPC_URL}")

    client = FullNodeClient(node_url=RPC_URL)
    account = Account(
        client=client,
        address=DEPLOYER_ADDRESS,
        key_pair=KeyPair.from_private_key(DEPLOYER_PRIVATE_KEY),
        chain=CHAIN_ID,
    )

    print(f"Deployer: {hex(DEPLOYER_ADDRESS)}")

    # 1. Read compiled contracts
    event_ticket_compiled = read_contract("starknet_nft_ticketing_EventTicket")
    marketplace_compiled = read_contract("starknet_nft_ticketing_Marketplace")
    paymaster_compiled = read_contract("starknet_nft_ticketing_Paymaster")
    factory_compiled = read_contract("starknet_nft_ticketing_TicketFactory")

    deployments = {}

    # 2. Declare EventTicket class
    print("\n--- Declaring EventTicket ---")
    declare_result = await Contract.declare_v3(
        account=account,
        compiled_contract=event_ticket_compiled["sierra"],
        compiled_contract_casm=event_ticket_compiled["casm"],
    )
    await declare_result.wait_for_acceptance()
    ticket_class_hash = declare_result.class_hash
    print(f"EventTicket class_hash: {hex(ticket_class_hash)}")
    deployments["ticket_class_hash"] = hex(ticket_class_hash)

    # 3. Deploy Marketplace
    print("\n--- Deploying Marketplace ---")
    marketplace_declare = await Contract.declare_v3(
        account=account,
        compiled_contract=marketplace_compiled["sierra"],
        compiled_contract_casm=marketplace_compiled["casm"],
    )
    await marketplace_declare.wait_for_acceptance()

    marketplace_deploy = await marketplace_declare.deploy_v3(
        constructor_args={
            "owner": DEPLOYER_ADDRESS,
            "payment_token": STRK_ADDRESS,
            "platform_fee_bps": 200,  # 2%
            "platform_treasury": DEPLOYER_ADDRESS,
        },
    )
    await marketplace_deploy.wait_for_acceptance()
    marketplace_address = marketplace_deploy.deployed_contract.address
    print(f"Marketplace: {hex(marketplace_address)}")
    print(f"  -> {STARKSCAN_URL}/contract/{hex(marketplace_address)}")
    deployments["marketplace_address"] = hex(marketplace_address)

    # 4. Deploy Paymaster
    print("\n--- Deploying Paymaster ---")
    paymaster_declare = await Contract.declare_v3(
        account=account,
        compiled_contract=paymaster_compiled["sierra"],
        compiled_contract_casm=paymaster_compiled["casm"],
    )
    await paymaster_declare.wait_for_acceptance()

    paymaster_deploy = await paymaster_declare.deploy_v3(
        constructor_args={
            "owner": DEPLOYER_ADDRESS,
            "strk_token": STRK_ADDRESS,
            "max_gas_per_tx": 500000,
            "max_txs_per_day": 100,
            "min_interval": 60,
        },
    )
    await paymaster_deploy.wait_for_acceptance()
    paymaster_address = paymaster_deploy.deployed_contract.address
    print(f"Paymaster: {hex(paymaster_address)}")
    print(f"  -> {STARKSCAN_URL}/contract/{hex(paymaster_address)}")
    deployments["paymaster_address"] = hex(paymaster_address)

    # 5. Deploy TicketFactory
    print("\n--- Deploying TicketFactory ---")
    factory_declare = await Contract.declare_v3(
        account=account,
        compiled_contract=factory_compiled["sierra"],
        compiled_contract_casm=factory_compiled["casm"],
    )
    await factory_declare.wait_for_acceptance()

    factory_deploy = await factory_declare.deploy_v3(
        constructor_args={
            "ticket_class_hash": ticket_class_hash,
            "owner": DEPLOYER_ADDRESS,
        },
    )
    await factory_deploy.wait_for_acceptance()
    factory_address = factory_deploy.deployed_contract.address
    print(f"TicketFactory: {hex(factory_address)}")
    print(f"  -> {STARKSCAN_URL}/contract/{hex(factory_address)}")
    deployments["factory_address"] = hex(factory_address)

    # 6. Save deployments
    with open(DEPLOYMENTS_FILE, "w") as f:
        json.dump(deployments, f, indent=2)
    print(f"\nDeployments saved to {DEPLOYMENTS_FILE}")

    # 7. Print .env update
    print("\n--- Add to .env ---")
    print(f"FACTORY_ADDRESS={hex(factory_address)}")
    print(f"MARKETPLACE_ADDRESS={hex(marketplace_address)}")
    print(f"PAYMASTER_ADDRESS={hex(paymaster_address)}")

    print("\nDeployment complete!")


def read_contract(name: str) -> dict:
    sierra_path = CONTRACTS_DIR / f"{name}.contract_class.json"
    casm_path = CONTRACTS_DIR / f"{name}.compiled_contract_class.json"

    if not sierra_path.exists():
        raise FileNotFoundError(f"Sierra file not found: {sierra_path}")
    if not casm_path.exists():
        raise FileNotFoundError(f"CASM file not found: {casm_path}")

    # Patch CASM: starknet-py 0.25 requires pythonic_hints but Scarb 2.9 omits it
    casm_data = json.loads(casm_path.read_text())
    if "pythonic_hints" not in casm_data:
        casm_data["pythonic_hints"] = []

    return {
        "sierra": sierra_path.read_text(),
        "casm": json.dumps(casm_data),
    }


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=__import__("sys").stderr)
        raise SystemExit(1)
    except Exception as e:
        print(f"ERROR: Deployment failed: {e}", file=__import__("sys").stderr)
        raise SystemExit(1)
