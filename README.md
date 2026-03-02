# Starknet NFT Ticketing

Plateforme de billetterie decentralisee sur Starknet. Chaque billet est un NFT unique, infalsifiable, avec revente controlee et QR code dynamique.

A decentralized event ticketing platform on Starknet. Every ticket is a unique NFT with on-chain ownership, controlled resale, and dynamic QR codes.

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│  Frontend    │────▶│  Backend    │────▶│  Starknet        │
│  Next.js 14  │     │  Fastify    │     │  Cairo Contracts │
│  StarkZap    │     │  BullMQ     │     │  Sepolia / Main  │
│  Cartridge   │     │  AVNU PM    │     │                  │
└─────────────┘     └──────┬──────┘     └──────────────────┘
                           │
                    ┌──────┴──────┐
                    │  PostgreSQL │
                    │  Redis      │
                    └─────────────┘
```

---

## Documentation

| | Document | Langue | Public |
|---|----------|--------|--------|
| **[Documentation Technique](TECHNICAL.md)** | Architecture, API, smart contracts, securite, setup, tests | English | Developpeurs, CTO, equipe technique |
| **[Dossier Investisseurs](INVESTISSEURS.md)** | Fonctionnalites, parcours utilisateur, modele de revenus, avantages concurrentiels | Francais | Investisseurs, partenaires, non-techniques |

---

## En bref / At a glance

| | |
|---|---|
| **Billets NFT** | ERC-721 sur Starknet, infalsifiables, transferables |
| **Paiement** | Carte bancaire (Stripe), virement (Weero), crypto (STRK/USDC/USDT) |
| **Scan QR** | Dynamique (25s), validation < 50 ms, anti-double utilisation |
| **Marketplace** | Revente P2P, plafond de prix, royalties automatiques, 2% commission |
| **Paymaster** | Zero frais blockchain via AVNU Paymaster (sponsorise par l'organisateur) |
| **Wallet** | Connexion Cartridge Controller via StarkZap (passkeys, biometrie, social login) |
| **Digital Twin Bridge** | Pont automatique Eventbrite/Weezevent -> NFT Starknet |
| **Securite** | Soulbound, recovery, sessions Cartridge, circuit breaker, audit red-team (49 correctifs) |
| **Tests** | 397 tests automatises (87 Cairo + 242 backend + 68 frontend), dont 30 simulations d'attaque |
| **CI/CD** | GitHub Actions, 3 pipelines paralleles |

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| **Smart contracts** | Cairo 2.9, Scarb 2.9.2, Starknet Foundry 0.35.1 |
| **Backend** | Node.js 22, Fastify 5, TypeScript 5, Prisma 5, BullMQ 5 |
| **Frontend** | Next.js 14, React 18, Tailwind CSS 3, StarkZap SDK |
| **Auth** | Cartridge Controller (passkeys, biometrie, social login) |
| **Gas** | AVNU Paymaster (transactions gasless) |
| **Blockchain** | Starknet (Sepolia / Mainnet), starknet.js v9 |
| **Infra** | PostgreSQL 16, Redis 7, Docker Compose, GitHub Actions |

---

## Quick start

```bash
# Infrastructure
docker compose up -d

# Backend
cd backend && npm ci && npx prisma migrate dev && npm run dev

# Frontend
cd frontend && npm ci && npm run dev

# Deploy contracts (optional)
cd deploy && npx tsx deploy.ts
```

---

## License

MIT
