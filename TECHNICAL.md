# Starknet NFT Ticketing -- Technical Documentation

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

## Digital Twin Bridge

Connects external (classical) ticketing providers to Starknet NFTs. Each off-chain ticket sale triggers an automatic NFT mint. Buyers claim their NFT by logging in with the same email.

```
External Provider ──webhook──▶ POST /v1/bridge/webhook (HMAC-SHA256)
                                    │
                                    ▼
                              BridgedTicket (PENDING)
                                    │
                              bridgeMint queue (BullMQ)
                                    │
                                    ▼
                          mintTicket() → vault address
                              BridgedTicket (MINTED)
                                    │
                   User logs in (Web3Auth, email match)
                                    │
                              POST /v1/bridge/claim (JWT)
                                    │
                              bridgeClaim queue (BullMQ)
                                    │
                                    ▼
                        transferTicket() → user wallet
                              BridgedTicket (CLAIMED)
```

**Key design decisions:**
- **Vault pattern** — NFTs mint to the deployer address (vault), then transfer to the user on claim, bridging the gap between email-based ticketing and wallet-based ownership
- **HMAC-SHA256 webhook auth** — each organizer has an API key; the external provider signs payloads with `sha256=<hex>`, verified with `crypto.timingSafeEqual`
- **Idempotency** — duplicate webhooks are safe via `@@unique([externalTicketId, organizerId])` compound key
- **Marketplace whitelist** — `transfer_ticket` requires the caller to be in `allowed_marketplaces`; the bridge worker calls `add_marketplace(DEPLOYER_ADDRESS)` once per event contract (cached in Redis for 24h)
- **Soulbound guard** — soulbound events are rejected at both webhook and worker level (soulbound NFTs cannot be transferred)
- **Status machine** — `PENDING → MINTED → CLAIMING → CLAIMED` (or `FAILED` with `errorMessage`). The `CLAIMING` state is an atomic transitional lock preventing double-claim races

## Smart Contracts (Cairo)

| Contract | Description |
|----------|-------------|
| **EventTicket** | ERC-721 NFT — mint, batch_mint, transfer, mark_used, staff roles, price caps, royalties, soulbound mode, transfer limits, pause mechanism |
| **TicketFactory** | Deploys one EventTicket per event, pause mechanism, upgradeable ticket class hash |
| **Marketplace** | P2P resale — list, buy, cancel with CEI anti-reentrancy, 2% platform fee, marketplace whitelist, pause mechanism, events (ListingCreated/Cancelled/Purchased), view functions |
| **Paymaster** | Per-organizer gas sponsorship — budgets, daily limits, anti-spam (interval + daily tx count), account sponsoring, pause mechanism |
| **AccountContract** | SNIP-6 abstract account — 24h scoped session keys, guardian + timelock recovery, owner key rotation |

## Backend (TypeScript)

| Layer | Components |
|-------|------------|
| **Routes** | `scan`, `tickets`, `events`, `marketplace`, `payments` (crypto), `webhooks` (Stripe), `bridge` (Digital Twin) |
| **Services** | `qr` (HMAC-SHA256 signing), `starknet` (mint/transfer/markUsed with circuit breaker + retry, ERC20 verification), `bridge` (HMAC webhook verification), `ticket` (Prisma CRUD) |
| **Auth** | JWT with roles: `organizer`, `staff`, `fan` — typed via Fastify module augmentation |
| **Queue** | BullMQ workers for async on-chain operations (mint, markUsed, bridgeMint, bridgeClaim) |
| **DB** | PostgreSQL (Prisma singleton) + Redis (ticket cache, atomic double-spend prevention) |
| **Indexer** | Starknet event indexer with adaptive backoff |
| **Monitoring** | Prometheus metrics (`/metrics`), request latency histograms, queue job counters, cache hit/miss, Starknet tx counters |
| **Docs** | OpenAPI/Swagger UI at `/docs`, auto-generated from route schemas |
| **Hardening** | Helmet security headers, Zod UUID validation on all params, graceful shutdown, circuit breaker for RPC, correlation ID tracing, global error handler |

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
                │          ├──< Listing
                │          └──? BridgedTicket
                └──< PendingMint
```

- **Organizer** — treasury address, paymaster address, API key (used for bridge HMAC)
- **Event** — contract address, max supply, resale cap, royalty bps, accepted currencies, payment token address
- **Ticket** — token ID, owner, status (`AVAILABLE` / `LISTED` / `USED` / `CANCELLED` / `REVOKED`)
- **Listing** — seller, price, on-chain listing ID
- **ScanLog** — gate ID, offline flag, sync status
- **PendingMint** — Stripe payment intent or crypto tx hash, buyer wallet, payment amount/currency
- **BridgedTicket** — external ticket ID, owner email, status (`PENDING` / `MINTED` / `CLAIMING` / `CLAIMED` / `FAILED`), vault address, mint/claim tx hashes

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | — | Health check (DB + Redis with 5s timeout) |
| `GET` | `/metrics` | — | Prometheus metrics (request latency, queue jobs, cache, Starknet tx) |
| `GET` | `/docs` | — | OpenAPI/Swagger UI |
| `POST` | `/v1/scan/validate` | staff | Validate QR (< 50 ms) |
| `POST` | `/v1/webhooks/stripe` | — | Stripe payment webhook |
| `POST` | `/v1/events` | organizer | Create event + deploy contract |
| `GET` | `/v1/events` | organizer | List events |
| `GET` | `/v1/events/:id` | any | Get event details |
| `GET` | `/v1/tickets` | fan | User's tickets |
| `GET` | `/v1/tickets/:id` | fan | Get ticket details |
| `GET` | `/v1/tickets/:id/qr` | fan | Generate signed QR payload |
| `GET` | `/v1/tickets/:id/qr-image` | fan | Generate QR as data URL image |
| `GET` | `/v1/events/:eventId/tickets` | fan | List tickets for an event |
| `GET` | `/v1/marketplace/listings` | public | Active listings (paginated) |
| `POST` | `/v1/marketplace/listings` | fan | Create listing |
| `DELETE` | `/v1/marketplace/listings/:id` | fan | Cancel listing |
| `POST` | `/v1/payments/verify-crypto` | fan | Verify on-chain ERC20 payment (STRK/USDC/USDT) |
| `POST` | `/v1/bridge/webhook` | HMAC | External ticketing webhook (auto-mints NFT) |
| `POST` | `/v1/bridge/claim` | fan | Claim bridged tickets (transfer from vault to wallet) |
| `GET` | `/v1/bridge/status/:id` | fan | Check bridged ticket status |
| `GET` | `/v1/bridge/tickets` | fan | List user's bridged tickets |

## Security

**On-chain**
- CEI pattern in Marketplace (anti-reentrancy)
- Price cap enforced on-chain (`resale_cap_bps`)
- Session keys scoped and time-limited (max 24h)
- Account recovery with guardian + 24h timelock
- Session keys auto-revoked on recovery execution
- Session keys auto-revoked on owner key rotation (prevents old session reuse)
- Zero-address validation on all mint and transfer recipients
- Owner-only access control on TicketFactory `create_event`
- `total_supply` decremented on ticket revocation (supply consistency)
- Transfer count tracking on `TicketTransferred` events (enforces transfer limits)
- Emergency pause mechanism on all contracts (EventTicket, TicketFactory, Marketplace, Paymaster)
- Batch mint with pre-validation (supply check, zero-address guard, duplicate detection)
- Marketplace emits ListingCreated/Cancelled/Purchased events for indexing

**Backend**
- Helmet security headers (HSTS, X-Frame-Options, etc.)
- QR codes rotate every 25s, expire at 30s server-side
- HMAC-SHA256 signed QR payloads with hex-only signature validation
- Redis `SET EX NX` for atomic anti-double-scan (single atomic command)
- Zod UUID validation on all route params
- Sanitized error responses (no internal details leaked)
- Graceful shutdown (SIGTERM/SIGINT)
- Circuit breaker on Starknet RPC (auto-opens after 5 failures, half-open probe after 30s)
- Transient-only retry (network/timeout errors retried, contract reverts fail fast)
- Health check with 5s timeout on DB + Redis
- Strict env validation (hex format, URL format, Stripe key prefix)
- Bridge webhook HMAC-SHA256 signature verification with `crypto.timingSafeEqual`
- Bridge rate limiting: 100 req/min (webhook), 10 req/min (claim)
- JWT email binding on bridge claim (email from verified JWT, not request body)
- Atomic `CLAIMING` status transition prevents double-claim race conditions
- Anti-enumeration: uniform 401 responses on webhook (organizer exists or not)
- Redis HSET batch for markUsed worker (crash-safe, replaces in-memory Map)
- Nonce mutex prevents concurrent transaction nonce collisions
- Atomic tokenId allocation via Redis INCR (prevents duplicate token IDs)
- Correlation ID request tracing (`X-Request-Id` header propagation)
- Global error handler (no stack trace leaks on 5xx, sanitized messages)

**Security audit**
- Red-team hostile audit: 49 vulnerabilities identified and fixed (8 CRITICAL, 20 HIGH, 21 MEDIUM)
- 30 attack simulation tests validating defenses: webhook forgery, ticket theft, double-claim races, JWT manipulation, replay attacks, payload injection, privilege escalation, scan abuse, cross-organizer breaches, soulbound bypass

**Frontend**
- Content Security Policy (Web3Auth + RPC domains whitelisted)
- HSTS with preload, Permissions-Policy
- AbortController on all fetch calls (prevents memory leaks)

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
# Cairo contracts (139 tests)
cd contracts
snforge test

# Backend (235 tests, with coverage)
cd backend
npm test -- --coverage

# Frontend (68 tests, with coverage)
cd frontend
npm test -- --coverage
npx tsc --noEmit
npx next build
```

## CI/CD

GitHub Actions runs 3 parallel jobs on every push/PR to `main`:

| Job | Steps | Duration |
|-----|-------|----------|
| **Contracts** | `scarb fmt --check` -> `scarb build` -> `snforge test` (139 tests) -> gas report -> artifact upload | ~2m |
| **Backend** | `npm ci` -> `prisma generate` -> `tsc --noEmit` -> `vitest --coverage` (235 tests, min 60%) | ~25s |
| **Frontend** | `npm ci` -> `vitest --coverage` (68 tests, min 50%) -> `tsc --noEmit` -> `next build` | ~50s |

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

### Bridge Flow (Digital Twin)

```
External ticketing provider sells ticket
  -> Provider sends webhook (HMAC-SHA256 signed)
  -> Backend validates signature + creates BridgedTicket (PENDING)
  -> bridgeMint worker mints NFT to vault address
  -> BridgedTicket updated to MINTED
  -> Buyer logs in via Web3Auth (same email)
  -> POST /v1/bridge/claim with JWT
  -> bridgeClaim worker transfers NFT from vault to user wallet
  -> BridgedTicket updated to CLAIMED
  -> User now owns the NFT ticket
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Cairo 2.9, Scarb, Starknet Foundry |
| Backend | Node.js 20, Fastify 5, TypeScript 5, Zod |
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
│   └── tests/              # snforge tests
├── backend/                # Fastify API
│   ├── src/
│   │   ├── api/            # Routes + middleware
│   │   ├── services/       # Business logic
│   │   ├── queue/          # BullMQ job definitions
│   │   ├── indexer/        # Starknet event indexer
│   │   └── db/             # Prisma singleton + schema + migrations + Redis
│   └── vitest.config.ts    # 235 Vitest tests
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
