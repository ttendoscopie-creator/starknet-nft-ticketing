# Starknet NFT Ticketing Platform

Decentralized event ticketing on Starknet with price-capped resale, on-chain royalties, and Web2-grade UX.

## Architecture

- **Smart Contracts**: Cairo 2.9 (EventTicket, Marketplace, AccountContract, Paymaster, TicketFactory)
- **Backend**: Node.js 20 + Fastify + BullMQ + Prisma + Redis
- **Frontend**: Next.js 14 + Tailwind CSS
- **Auth**: Web3Auth (invisible wallet)
- **Payments**: Stripe (webhook -> on-chain mint)

## Quick Start

### 1. Prerequisites

```bash
# Install Scarb (Cairo package manager)
curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh

# Install Starknet Foundry
curl -L https://raw.githubusercontent.com/foundry-rs/starknet-foundry/master/scripts/install.sh | sh
snfoundryup
```

### 2. Build & Test Contracts

```bash
cd contracts
scarb build
snforge test
# Expected: 9/9 tests pass
```

### 3. Start Infrastructure

```bash
cp .env.example .env
# Edit .env with your keys

docker compose up -d postgres redis
```

### 4. Run Backend

```bash
cd backend
npm install
npm run db:migrate
npm run dev
# Server at http://localhost:3001
```

### 5. Run Frontend

```bash
cd frontend
npm install
npm run dev
# App at http://localhost:3000
```

## Deploy to Starknet

```bash
# Build contracts
cd contracts && scarb build

# Deploy (requires funded Sepolia account)
pip install starknet-py python-dotenv
python deploy/deploy.py

# Run demo lifecycle
npx tsx deploy/demo.ts
```

## Smart Contracts

| Contract | Purpose |
|----------|---------|
| `EventTicket` | ERC-721-like ticket NFT with price cap, royalties, staff roles |
| `Marketplace` | Secondary market with CEI pattern, platform fees |
| `AccountContract` | SNIP-6 account with session keys (24h TTL, scoped) |
| `Paymaster` | Gas sponsorship with daily limits and whitelisting |
| `TicketFactory` | Deploy new EventTicket instances per event |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/scan/validate` | Validate ticket QR (< 50ms) |
| POST | `/v1/webhooks/stripe` | Stripe payment webhook |
| POST | `/v1/events` | Create event (organizer) |
| GET | `/v1/events` | List events |
| GET | `/v1/tickets` | User's tickets |
| GET | `/v1/tickets/:id/qr` | Generate QR payload |
| GET | `/v1/marketplace/listings` | Active marketplace listings |
| POST | `/v1/marketplace/listings` | Create listing |

## Security

- QR codes rotate every 25s, expire at 30s server-side
- Redis SETNX for atomic anti-double-scan
- HMAC-SHA256 signed QR payloads
- CEI pattern in Marketplace (anti-reentrancy)
- Price cap enforced on-chain (resale_cap_bps)
- Session keys scoped and time-limited (max 24h)
