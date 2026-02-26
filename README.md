# Starknet NFT Ticketing

A full-stack decentralized event ticketing platform on Starknet. Tickets are ERC-721 NFTs with on-chain ownership, a peer-to-peer marketplace, QR-based gate entry validated in under 50 ms, gasless transactions via a per-organizer paymaster, account recovery with guardian + timelock, and multi-currency crypto payments (STRK/USDC/USDT).

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│  Frontend    │────▶│  Backend    │────▶│  Starknet        │
│  Next.js 14  │     │  Fastify    │     │  Cairo Contracts │
│  Web3Auth    │     │  BullMQ     │     │  Sepolia / Main  │
└─────────────┘     └──────┬──────┘     └──────────────────┘
                           │
                    ┌──────┴──────┐
                    │  PostgreSQL │
                    │  Redis      │
                    └─────────────┘
```

## Smart Contracts (Cairo)

| Contract | Description |
|----------|-------------|
| **EventTicket** | ERC-721 NFT — mint, transfer, mark_used, staff roles, price caps, royalties, soulbound mode, transfer limits |
| **TicketFactory** | Deploys one EventTicket per event |
| **Marketplace** | P2P resale — list, buy, cancel with CEI anti-reentrancy, 2% platform fee, marketplace whitelist |
| **Paymaster** | Per-organizer gas sponsorship — budgets, daily limits, anti-spam (interval + daily tx count), account sponsoring |
| **AccountContract** | SNIP-6 abstract account — 24h scoped session keys, guardian + timelock recovery, owner key rotation |

## Backend (TypeScript)

| Layer | Components |
|-------|------------|
| **Routes** | `scan`, `tickets`, `events`, `marketplace`, `payments` (crypto), `webhooks` (Stripe) |
| **Services** | `qr` (HMAC-SHA256 signing), `starknet` (mint/markUsed with retry, ERC20 verification), `ticket` (Prisma CRUD) |
| **Auth** | JWT with roles: `organizer`, `staff`, `fan` |
| **Queue** | BullMQ workers for async on-chain operations (mint, markUsed) |
| **DB** | PostgreSQL (Prisma) + Redis (ticket cache, atomic double-spend prevention) |
| **Indexer** | Starknet event indexer for on-chain state sync |

## Frontend (Next.js 14)

| Page | Route | Description |
|------|-------|-------------|
| Landing | `/` | Home page |
| My Tickets | `/tickets` | NFT list + dynamic QR code |
| Marketplace | `/marketplace` | P2P resale listings |
| Scan | `/scan` | Camera-based QR scanner |
| Events | `/events` | Organizer dashboard |
| Staff | `/staff` | Team management |
| Analytics | `/analytics` | Event statistics |

**Auth**: Web3Auth social login -> derived Starknet key, offline mode with local cache.

## Database Schema

```
Organizer ──< Event ──< Ticket ──< ScanLog
                │          │
                │          └──< Listing
                └──< PendingMint
```

- **Organizer** — treasury address, paymaster address, API key
- **Event** — contract address, max supply, resale cap, royalty bps, accepted currencies, payment token address
- **Ticket** — token ID, owner, status (`AVAILABLE` / `LISTED` / `USED` / `CANCELLED`)
- **Listing** — seller, price, on-chain listing ID
- **ScanLog** — gate ID, offline flag, sync status
- **PendingMint** — Stripe payment intent or crypto tx hash, buyer wallet, payment amount/currency

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/scan/validate` | staff | Validate QR (< 50 ms) |
| `POST` | `/v1/webhooks/stripe` | — | Stripe payment webhook |
| `POST` | `/v1/events` | organizer | Create event + deploy contract |
| `GET` | `/v1/events` | organizer | List events |
| `GET` | `/v1/events/:id` | any | Get event details |
| `GET` | `/v1/tickets` | fan | User's tickets |
| `GET` | `/v1/tickets/:id/qr` | fan | Generate signed QR payload |
| `GET` | `/v1/marketplace/listings` | public | Active listings |
| `POST` | `/v1/marketplace/listings` | fan | Create listing |
| `DELETE` | `/v1/marketplace/listings/:id` | fan | Cancel listing |
| `POST` | `/v1/payments/verify-crypto` | fan | Verify on-chain ERC20 payment (STRK/USDC/USDT) |

## Security

- QR codes rotate every 25s, expire at 30s server-side
- HMAC-SHA256 signed QR payloads
- Redis SETNX for atomic anti-double-scan
- CEI pattern in Marketplace (anti-reentrancy)
- Price cap enforced on-chain (`resale_cap_bps`)
- Session keys scoped and time-limited (max 24h)
- Account recovery with guardian + 24h timelock
- Session keys auto-revoked on recovery execution

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.10+ (for contract deployment)
- [Scarb 2.9.2](https://docs.swmansion.com/scarb/) (Cairo build tool)
- [Starknet Foundry 0.35.1](https://foundry-rs.github.io/starknet-foundry/) (test framework)
- Docker (for PostgreSQL + Redis)

### Setup

```bash
# Clone
git clone https://github.com/ttendoscopie-creator/starknet-nft-ticketing.git
cd starknet-nft-ticketing

# Environment
cp .env.example .env
# Edit .env with your keys

# Infrastructure
docker compose up -d  # PostgreSQL + Redis

# Backend
cd backend
npm ci
npx prisma generate --schema=src/db/prisma/schema.prisma
npx prisma migrate dev --schema=src/db/prisma/schema.prisma
npm run dev
# Server at http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm ci
npm run dev
# App at http://localhost:3000
```

### Deploy Contracts (Sepolia)

```bash
cd contracts
scarb build

cd ../deploy
pip install starknet-py python-dotenv
python deploy.py
# Outputs deployments.json + .env values

# Run demo lifecycle
npx tsx demo.ts
```

### Run Tests

```bash
# Cairo contracts (71 tests)
cd contracts
snforge test

# Backend (107 tests)
cd backend
npm test

# Frontend (type check + build)
cd frontend
npx tsc --noEmit
npx next build
```

## CI/CD

GitHub Actions runs 3 parallel jobs on every push/PR to `main`:

| Job | Steps | Duration |
|-----|-------|----------|
| **Contracts** | `scarb fmt --check` -> `scarb build` -> `snforge test` -> gas report | ~1m45s |
| **Backend** | `npm ci` -> `prisma generate` -> `tsc --noEmit` -> `vitest` (107 tests) | ~25s |
| **Frontend** | `npm ci` -> `tsc --noEmit` -> `next build` | ~48s |

## Main Flow

```
Fan signs in (Web3Auth social login)
  -> Pays via Stripe or crypto (STRK/USDC/USDT)
  -> Backend creates PendingMint (Prisma)
  -> BullMQ worker mints NFT on-chain
  -> Fan sees ticket + dynamic QR (HMAC-SHA256, 30s TTL)
  -> Staff scans QR at gate
  -> Redis atomic SETNX (double-spend prevention)
  -> Backend confirms entry (< 50ms)
  -> Worker calls mark_used on-chain
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Cairo 2.9, Scarb, Starknet Foundry |
| Backend | Node.js 20, Fastify 4, TypeScript 5 |
| Database | PostgreSQL 16 (Prisma 5), Redis 7 (ioredis) |
| Queue | BullMQ 5 |
| Frontend | Next.js 14, React 18, Tailwind CSS 3 |
| Auth | Web3Auth v8, JWT |
| Payments | Stripe, STRK/USDC/USDT (on-chain ERC20) |
| Blockchain | Starknet (starknet.js v6) |
| Testing | snforge (Cairo), Vitest (TypeScript) |
| CI/CD | GitHub Actions |

## Project Structure

```
starknet-nft-ticketing/
├── contracts/              # Cairo smart contracts
│   ├── src/                # Contract sources (6 contracts)
│   └── tests/              # 71 snforge tests
├── backend/                # Fastify API
│   ├── src/
│   │   ├── api/            # Routes + middleware
│   │   ├── services/       # Business logic
│   │   ├── queue/          # BullMQ job definitions
│   │   ├── indexer/        # Starknet event indexer
│   │   └── db/             # Prisma schema + migrations + Redis
│   └── vitest.config.ts    # 107 Vitest tests
├── frontend/               # Next.js app
│   ├── app/                # Pages (App Router)
│   └── components/         # React components
├── deploy/
│   ├── deploy.py           # Contract deployment script (Python)
│   ├── deploy.ts           # Contract deployment script (TypeScript)
│   └── demo.ts             # Full lifecycle demo
├── docker-compose.yml      # PostgreSQL + Redis
└── .github/workflows/      # CI pipeline
```

## License

MIT
