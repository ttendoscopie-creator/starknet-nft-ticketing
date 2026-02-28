# Starknet NFT Ticketing

A full-stack decentralized event ticketing platform on Starknet. Tickets are ERC-721 NFTs with on-chain ownership, a peer-to-peer marketplace, QR-based gate entry validated in under 50 ms, gasless transactions via a per-organizer paymaster, account recovery with guardian + timelock, multi-currency crypto payments (STRK/USDC/USDT), and a **Digital Twin Bridge** that automatically mints NFTs from external ticketing providers (Eventbrite, Weezevent, etc.).

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
- **Status machine** — `PENDING → MINTED → CLAIMED` (or `FAILED` with `errorMessage`)

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
| **Routes** | `scan`, `tickets`, `events`, `marketplace`, `payments` (crypto), `webhooks` (Stripe), `bridge` (Digital Twin) |
| **Services** | `qr` (HMAC-SHA256 signing), `starknet` (mint/transfer/markUsed with circuit breaker + retry, ERC20 verification), `bridge` (HMAC webhook verification), `ticket` (Prisma CRUD) |
| **Auth** | JWT with roles: `organizer`, `staff`, `fan` — typed via Fastify module augmentation |
| **Queue** | BullMQ workers for async on-chain operations (mint, markUsed, bridgeMint, bridgeClaim) |
| **DB** | PostgreSQL (Prisma singleton) + Redis (ticket cache, atomic double-spend prevention) |
| **Indexer** | Starknet event indexer with adaptive backoff |
| **Hardening** | Helmet security headers, Zod UUID validation on all params, graceful shutdown, circuit breaker for RPC |

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
- **Ticket** — token ID, owner, status (`AVAILABLE` / `LISTED` / `USED` / `CANCELLED`)
- **Listing** — seller, price, on-chain listing ID
- **ScanLog** — gate ID, offline flag, sync status
- **PendingMint** — Stripe payment intent or crypto tx hash, buyer wallet, payment amount/currency
- **BridgedTicket** — external ticket ID, owner email, status (`PENDING` / `MINTED` / `CLAIMED` / `FAILED`), vault address, mint/claim tx hashes

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | — | Health check (DB + Redis with 5s timeout) |
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

**Backend**
- Helmet security headers (HSTS, X-Frame-Options, etc.)
- QR codes rotate every 25s, expire at 30s server-side
- HMAC-SHA256 signed QR payloads with hex-only signature validation
- Redis SETNX for atomic anti-double-scan
- Zod UUID validation on all route params
- Sanitized error responses (no internal details leaked)
- Graceful shutdown (SIGTERM/SIGINT)
- Circuit breaker on Starknet RPC (auto-opens after 5 failures, half-open probe after 30s)
- Transient-only retry (network/timeout errors retried, contract reverts fail fast)
- Health check with 5s timeout on DB + Redis
- Strict env validation (hex format, URL format, Stripe key prefix)
- Bridge webhook HMAC-SHA256 signature verification with `crypto.timingSafeEqual`
- Bridge rate limiting: 100 req/min (webhook), 10 req/min (claim)

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
# Cairo contracts (71 tests)
cd contracts
snforge test

# Backend (164 tests)
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
| **Backend** | `npm ci` -> `prisma generate` -> `tsc --noEmit` -> `vitest` (164 tests) | ~25s |
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
│   └── vitest.config.ts    # 164 Vitest tests
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

---

# Dossier Fonctionnel Investisseurs

## Vue d'ensemble

**Starknet NFT Ticketing** est une plateforme de billetterie decentralisee pour evenements (concerts, festivals, sport, conferences). Chaque billet vendu devient un **NFT** (jeton numerique unique) enregistre sur la blockchain Starknet. Cela signifie que chaque billet possede un certificat de propriete infalsifiable, verifiable par tous, et transferable de personne a personne sans intermediaire.

La plateforme couvre **l'integralite de la chaine de valeur** : creation d'evenement, vente de billets, paiement (carte bancaire ou crypto-monnaie), controle d'acces aux portes, revente entre particuliers, et meme le rattachement de billets vendus sur des plateformes classiques (Eventbrite, Weezevent, etc.).

---

## 1. Pourquoi la blockchain pour la billetterie ?

### Les problemes actuels de la billetterie classique

| Probleme | Impact |
|----------|--------|
| **Fraude et contrefacon** | Des millions de faux billets circulent chaque annee. Les acheteurs n'ont aucun moyen de verifier l'authenticite. |
| **Revente sauvage** | Les plateformes de revente (marche noir) fixent des prix exorbitants sans aucun controle de l'organisateur. |
| **Perte de controle** | Une fois le billet vendu, l'organisateur ne sait plus qui le possede. Aucune donnee sur les transferts. |
| **Frais d'intermediaires** | Chaque intermediaire (Ticketmaster, StubHub, revendeurs) preleve une commission. |
| **Billets perdus/voles** | Un billet papier ou PDF peut etre perdu, copie, ou partage sans controle. |

### Ce que la blockchain resout

| Solution | Comment |
|----------|---------|
| **Authenticite garantie** | Chaque billet est un NFT unique sur la blockchain. Impossible a contrefaire. |
| **Plafond de revente** | L'organisateur fixe un prix maximum de revente directement dans le code du contrat. Aucun depassement possible. |
| **Royalties automatiques** | A chaque revente, un pourcentage revient automatiquement a l'organisateur. Pas besoin de le reclamer. |
| **Tracabilite totale** | L'historique complet du billet (creation, ventes, transferts, utilisation) est visible sur la blockchain. |
| **Propriete reelle** | L'acheteur possede reellement son billet dans son portefeuille numerique. Aucun intermediaire ne peut le lui retirer. |

---

## 2. L'experience utilisateur -- Parcours complet

### 2.1 Le spectateur (fan)

**Etape 1 -- Connexion simplifiee**
Le spectateur se connecte avec son **compte Google, Apple, ou email**. Pas besoin de comprendre la blockchain ni de posseder un portefeuille crypto au prealable. La plateforme utilise **Web3Auth**, une technologie qui cree automatiquement un portefeuille blockchain invisible a partir de la connexion sociale. L'experience est identique a celle de n'importe quel site web moderne.

**Etape 2 -- Achat du billet**
Trois options de paiement :
- **Carte bancaire** via Stripe (Visa, Mastercard, etc.) -- identique a un achat en ligne classique.
- **Virement bancaire instantane** via Weero -- paiement par virement SEPA instantane, sans carte bancaire. Ideal pour les montants eleves ou les utilisateurs qui preferent payer directement depuis leur compte bancaire.
- **Crypto-monnaie** -- paiement en STRK (token natif Starknet), USDC ou USDT (stablecoins indexes sur le dollar). La plateforme verifie automatiquement le paiement sur la blockchain.

**Etape 3 -- Reception du billet NFT**
Apres paiement, le billet NFT est **cree automatiquement** (on dit "frappe" ou "mint") sur la blockchain et attribue au portefeuille du spectateur. Ce processus est gere en arriere-plan par une file d'attente qui garantit que meme en cas de forte affluence (ex: 10 000 ventes en 5 minutes), chaque billet est cree dans l'ordre et sans erreur.

**Etape 4 -- QR code dynamique**
Le spectateur accede a son billet depuis l'application. Un **QR code unique** est genere en temps reel. Ce QR code change toutes les 25 secondes et expire apres 30 secondes. Cela rend impossible la capture d'ecran ou la copie : un QR code photographie par un fraudeur sera deja invalide au moment ou il tente de l'utiliser.

**Etape 5 -- Entree a l'evenement**
Le personnel au portique scanne le QR code avec l'application. La validation se fait en **moins de 50 millisecondes** (0,05 seconde). Le systeme utilise un mecanisme atomique qui rend **physiquement impossible** la double utilisation : meme si deux portiques scannent le meme QR code a la meme milliseconde, un seul passage sera autorise.

**Etape 6 -- Revente**
Si le spectateur ne peut plus se rendre a l'evenement, il peut mettre son billet en vente sur la **place de marche integree**. Le prix est automatiquement plafonne par les regles definies par l'organisateur (par exemple : maximum 120% du prix d'achat). A chaque revente, des royalties sont versees automatiquement a l'organisateur.

### 2.2 L'organisateur

**Etape 1 -- Creation de l'evenement**
L'organisateur cree un evenement via l'interface. En coulisses, un **contrat intelligent** (smart contract) est deploye automatiquement sur la blockchain. Ce contrat contient toutes les regles de l'evenement : nombre maximum de billets, prix, plafond de revente, royalties, devises acceptees.

**Etape 2 -- Configuration avancee**
L'organisateur peut configurer :
- **Nombre maximum de billets** -- applique par le contrat blockchain (impossible de depasser, meme en cas de bug).
- **Plafond de revente** -- exprime en pourcentage du prix original (ex: 150% = le billet ne peut pas etre revendu a plus de 1,5x son prix).
- **Royalties** -- pourcentage preleve automatiquement sur chaque revente (ex: 5% revient a l'organisateur).
- **Mode "Soulbound"** -- si active, le billet est **intransferable**. Il est lie a l'identite de l'acheteur original et ne peut etre ni revendu, ni donne. Utile pour les evenements ou l'identite du porteur est importante (examens, ceremonies, VIP).
- **Devises acceptees** -- STRK, USDC, USDT, ou combinaison.
- **Sponsorisation des frais** -- l'organisateur peut payer les frais de transaction blockchain a la place des spectateurs (voir section Paymaster).

**Etape 3 -- Gestion du personnel**
L'organisateur attribue des roles : les membres du "staff" peuvent scanner les billets aux portes. Les droits d'acces sont geres par le systeme d'authentification (organizer/staff/fan).

**Etape 4 -- Tableau de bord et analytics**
Interface de suivi en temps reel : billets vendus, billets scannes, revenus, activite de revente.

---

## 3. Les fonctionnalites cles en detail

### 3.1 Billet intelligent (Smart Ticket)

Chaque billet n'est pas un simple jeton. C'est un **objet programmable** dont le comportement est regi par un contrat intelligent. Voici ses proprietes :

| Propriete | Description | Avantage business |
|-----------|-------------|-------------------|
| **Plafond de prix** | Le prix de revente ne peut pas depasser un maximum fixe par l'organisateur | Elimine la speculation sauvage |
| **Royalties automatiques** | A chaque revente, un pourcentage revient a l'organisateur | Revenus passifs sur le marche secondaire |
| **Etat dynamique** | Le billet passe par des etats : Disponible -> En vente -> Utilise -> Annule | Suivi en temps reel de chaque billet |
| **Controle d'acces** | Seul le personnel autorise (role STAFF) peut valider un billet | Securite aux portes |
| **Mode Soulbound** | Billet non-transferable, lie a son proprietaire | Anti-revente totale quand necessaire |
| **Limite de transferts** | Nombre maximum de reventes configurable | Controle de la circulation |

### 3.2 Transactions sans frais pour l'utilisateur (Paymaster)

Un des freins majeurs a l'adoption de la blockchain est le **cout des transactions** (appeles "gas fees"). Notre plateforme integre un systeme de **Paymaster** qui permet a l'organisateur de **prendre en charge les frais de transaction** a la place du spectateur.

Fonctionnement :
- L'organisateur depose un **budget** sur le Paymaster.
- Chaque transaction effectuee par un spectateur (achat, transfert, revente) est **sponsorisee** : le spectateur ne paie rien en frais blockchain.
- Des **limites quotidiennes** empechent les abus (par exemple : maximum 10 transactions par jour par utilisateur).
- Un systeme **anti-spam** empeche les utilisateurs malveillants d'epuiser le budget (delai minimum entre chaque transaction).

Resultat : **l'utilisateur final ne voit jamais de frais blockchain**. L'experience est identique a celle d'une application classique.

### 3.3 Place de marche integree (Marketplace)

La plateforme inclut une **place de marche de revente peer-to-peer** (de particulier a particulier), directement integree :

- **Mise en vente** : le possesseur d'un billet le met en vente en un clic.
- **Achat** : l'acheteur paie et recoit instantanement le billet dans son portefeuille.
- **Commission plateforme** : 2% preleves automatiquement sur chaque transaction de revente.
- **Plafond de prix** : le prix est automatiquement bloque si il depasse le maximum autorise par l'organisateur.
- **Royalties organisateur** : versees automatiquement a chaque revente.
- **Securite anti-fraude** : le contrat utilise le pattern CEI (Checks-Effects-Interactions), une methode de programmation qui rend impossible les attaques par reentrance (une technique de piratage classique en blockchain).

### 3.4 Controle d'acces rapide (Scan QR)

Le systeme de scan est concu pour les evenements de grande capacite (stades, festivals) :

- **Temps de validation : < 50 ms** (0,05 seconde). Plus rapide qu'un lecteur de code-barres classique.
- **QR code dynamique** : change toutes les 25 secondes. Impossible a photocopier ou a partager par capture d'ecran.
- **Signature cryptographique** : chaque QR code est signe numeriquement. Un QR code modifie ou forge est immediatement rejete.
- **Anti-double utilisation atomique** : meme si deux agents scannent le meme billet au meme instant, un seul passage est autorise. Le systeme utilise une operation Redis SETNX (Set if Not Exists), une primitive de base de donnees qui garantit l'unicite au niveau materiel.
- **Mode hors-ligne** : en cas de coupure reseau au lieu de l'evenement, les scans sont mis en cache localement et synchronises des que la connexion revient.

### 3.5 Bridge Digital Twin (Pont Jumeau Numerique)

C'est la fonctionnalite la plus innovante et celle qui differencie la plateforme de ses concurrents. Le **Digital Twin Bridge** permet de **connecter n'importe quelle plateforme de billetterie classique** (Eventbrite, Weezevent, See Tickets, etc.) a la blockchain.

**Le probleme** : un organisateur utilise deja Eventbrite pour vendre ses billets. Il veut offrir a ses spectateurs les avantages de la blockchain (propriete, revente controlee, collectible) sans changer de plateforme de vente.

**La solution** :

1. **Le spectateur achete son billet normalement** sur Eventbrite/Weezevent/etc.
2. **La plateforme classique envoie une notification automatique** (webhook) a notre systeme pour chaque vente.
3. **Notre systeme cree automatiquement le NFT correspondant** sur la blockchain Starknet. Le NFT est temporairement conserve dans un "coffre-fort" (vault) en attendant que l'acheteur le reclame.
4. **L'acheteur se connecte** sur notre application avec le meme email que celui utilise pour l'achat.
5. **Le NFT lui est automatiquement transfere** dans son portefeuille.

Le spectateur se retrouve avec un **billet classique** (pour l'entree) ET un **NFT** (pour la propriete, la revente, et la collectibilite). D'ou le nom "Digital Twin" : le NFT est le jumeau numerique du billet classique.

**Securite du bridge** :
- Chaque notification est **signee cryptographiquement** (HMAC-SHA256). Une notification forgee est immediatement rejetee.
- Le systeme est **idempotent** : si la plateforme classique envoie la meme notification deux fois (ce qui arrive frequemment), le second envoi est ignore. Pas de doublon.
- Les evenements en mode **Soulbound** sont automatiquement rejetes (un NFT intransferable ne peut pas etre depose dans un coffre-fort pour etre reclame).
- **Limitation du debit** : 100 notifications par minute (webhook), 10 reclamations par minute (claim). Protection contre les surcharges et les abus.

### 3.6 Recuperation de compte (Account Recovery)

Si un spectateur perd acces a son compte (telephone perdu, oubli de mot de passe), un systeme de recuperation securise est en place :

- **Gardien** : un tiers de confiance (ami, service client) est designe a l'avance.
- **Delai de securite de 24h** : une demande de recuperation ne prend effet qu'apres 24 heures. Si le proprietaire legitime revient entre-temps, il peut annuler la demande.
- **Revocation automatique** : toutes les sessions actives et cles temporaires sont automatiquement invalidees lors d'une recuperation.

Ce systeme empeche un attaquant de voler un compte meme s'il a acces au gardien : le proprietaire a 24 heures pour bloquer l'operation.

### 3.7 Sessions temporaires (Session Keys)

Pour eviter que l'utilisateur ait a approuver chaque action individuellement (ce qui est une friction majeure en blockchain), le systeme utilise des **cles de session** :

- L'utilisateur approuve une session une seule fois.
- Pendant **24 heures maximum**, les actions sont pre-approuvees (achats, transferts, scans).
- Chaque cle de session a un **perimetre limite** : elle ne peut effectuer que certaines actions precises.
- Les cles expirent automatiquement et sont revoquees en cas de recuperation de compte.

---

## 4. Modele de revenus

| Source de revenus | Description | Qui paie |
|-------------------|-------------|----------|
| **Commission de vente primaire** | Pourcentage sur chaque billet vendu | Organisateur |
| **Commission marketplace** | 2% sur chaque revente P2P | Vendeur |
| **Royalties organisateur** | Configurables par evenement (ex: 5%) | Acheteur secondaire |
| **Frais de bridge** | Possibilite de facturer le minting automatique | Organisateur |
| **Sponsorisation Paymaster** | L'organisateur depose un budget pour payer les frais de ses spectateurs | Organisateur |

---

## 5. Avantages concurrentiels

### 5.1 Par rapport aux plateformes classiques (Ticketmaster, Eventbrite)

| Critere | Classique | Notre solution |
|---------|-----------|----------------|
| Contrefacon | Possible (PDF copiable) | Impossible (NFT unique sur blockchain) |
| Revente sauvage | Aucun controle | Prix plafonne par contrat intelligent |
| Royalties sur revente | Inexistantes | Automatiques et programmables |
| Propriete du billet | Licence revocable | Propriete reelle (NFT) |
| Tracabilite | Limitee | Complete et publique |
| Frais utilisateur blockchain | N/A | Zero (Paymaster) |

### 5.2 Par rapport aux concurrents blockchain (GET Protocol, YellowHeart, GUTS)

| Critere | Concurrents | Notre solution |
|---------|-------------|----------------|
| Blockchain | Ethereum / Polygon (couteux, lent) | Starknet (rapide, economique, ZK-proofs) |
| Bridge ticketing classique | Limites ou inexistant | Digital Twin Bridge complet et automatise |
| Scan QR | Statique | Dynamique (25s), signe cryptographiquement |
| Temps de scan | Variable | Garanti < 50 ms |
| Transactions gasless | Partiel | Paymaster complet avec budgets et anti-spam |
| Recuperation de compte | Basique ou inexistante | Gardien + timelock 24h + revocation automatique |
| Mode Soulbound | Rarement disponible | Integre nativement |
| Mode hors-ligne | Non supporte | Cache local + synchronisation automatique |

### 5.3 Starknet : pourquoi cette blockchain ?

- **Cout** : les transactions coutent une fraction de centime (vs. plusieurs dollars sur Ethereum).
- **Vitesse** : finalite en quelques secondes.
- **Scalabilite** : Starknet utilise des preuves Zero-Knowledge (ZK-STARKs), permettant de traiter des milliers de transactions par seconde sans congestionner le reseau.
- **Securite** : herite de la securite d'Ethereum (les preuves sont verifiees sur Ethereum L1).
- **Ecosystem** : supporte par StarkWare, Ethereum Foundation, et un ecosystem de developpeurs en forte croissance.

---

## 6. Maturite technique

### 6.1 Tests automatises

La plateforme est couverte par **235 tests automatises** qui verifient le bon fonctionnement de chaque composant :

| Composant | Nombre de tests | Couverture |
|-----------|----------------|------------|
| Contrats intelligents (Cairo) | 71 tests | Mint, transfert, revente, plafonds, royalties, soulbound, sessions, recovery, paymaster |
| Backend (TypeScript) | 164 tests | Routes, services, workers, integration, bridge, securite |
| **Total** | **235 tests** | |

### 6.2 Integration continue (CI/CD)

A chaque modification du code, **3 pipelines automatiques** se lancent en parallele :

1. **Contrats** : verification du formatage, compilation, execution des 71 tests, rapport de consommation de gas.
2. **Backend** : installation des dependances, verification des types, execution des 164 tests.
3. **Frontend** : verification des types, compilation de production.

Si un seul test echoue, la modification est rejetee. Cela garantit que le code en production est toujours fonctionnel.

### 6.3 Architecture

La plateforme est composee de **6 contrats intelligents** sur la blockchain et d'une application complete (serveur + interface). L'architecture est modulaire : chaque composant peut etre mis a jour independamment.

| Couche | Technologie | Maturite |
|--------|-------------|----------|
| Blockchain | Starknet + Cairo 2.9 | Production-ready |
| Serveur | Node.js + Fastify + TypeScript | Production-ready |
| Base de donnees | PostgreSQL + Redis | Standard industriel |
| File d'attente | BullMQ | Standard industriel |
| Interface | Next.js + React | Standard industriel |
| Authentification | Web3Auth + JWT | Standard industriel |
| Paiement | Stripe + Weero + crypto (STRK/USDC/USDT) | Standard industriel |

---

## 7. Securite -- Resume non technique

| Menace | Protection |
|--------|-----------|
| Faux billets | Chaque billet est un NFT unique sur la blockchain, impossible a dupliquer |
| Copie de QR code | Le QR change toutes les 25 secondes et est signe cryptographiquement |
| Double utilisation d'un billet | Mecanisme atomique : un seul passage possible, meme en cas de scan simultane |
| Revente abusive | Plafond de prix applique par le contrat intelligent (non modifiable) |
| Vol de compte | Recuperation avec gardien + delai de securite de 24 heures |
| Attaques sur la plateforme | Limitation de debit, validation stricte de toutes les donnees, en-tetes de securite |
| Notification forgee (bridge) | Signature cryptographique obligatoire sur chaque notification externe |
| Epuisement du budget Paymaster | Limites quotidiennes et anti-spam par utilisateur |
| Panne reseau au lieu de l'evenement | Mode hors-ligne avec synchronisation automatique |

---

## 8. Cas d'usage cibles

1. **Concerts et festivals** -- Gestion de billets NFT avec revente controlee et royalties.
2. **Evenements sportifs** -- Stades de grande capacite avec scan < 50 ms.
3. **Conferences professionnelles** -- Billets Soulbound (non-transferables) lies a l'identite.
4. **Spectacles** -- Bridge avec les plateformes de vente existantes (pas besoin de changer d'outil).
5. **Experiences VIP** -- Le NFT devient un collectible apres l'evenement (valeur memorielle et commerciale).

---

## 9. Feuille de route potentielle

| Phase | Fonctionnalite | Statut |
|-------|---------------|--------|
| V1 | Contrats intelligents (mint, transfert, marketplace, paymaster, account) | Fait |
| V2 | Backend complet (paiement, scan, workers, securite) | Fait |
| V2.1 | Digital Twin Bridge (Eventbrite/Weezevent/etc.) | Fait |
| V3 | Application mobile native (iOS/Android) | A developper |
| V3 | Dashboard analytics avance pour organisateurs | A developper |
| V4 | NFT collectibles post-evenement (souvenirs numeriques) | A developper |
| V4 | Programme de fidelite cross-evenements | A developper |
| V5 | Integration directe Ticketmaster / See Tickets | A developper |

---

## 10. Chiffres cles

- **6** contrats intelligents sur blockchain
- **19** endpoints API (points d'entree du serveur)
- **235** tests automatises (71 blockchain + 164 serveur)
- **< 50 ms** temps de validation d'un billet au portique
- **25 s** rotation du QR code (anti-copie)
- **24 h** delai de securite pour la recuperation de compte
- **2%** commission marketplace sur les reventes
- **3** devises crypto acceptees (STRK, USDC, USDT)
- **0** frais blockchain pour l'utilisateur final (Paymaster)

---

*Document genere a partir de la documentation technique du projet Starknet NFT Ticketing -- Fevrier 2026*

## License

MIT
