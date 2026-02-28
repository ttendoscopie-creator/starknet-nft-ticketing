# Starknet NFT Ticketing

Plateforme de billetterie decentralisee sur Starknet. Chaque billet est un NFT unique, infalsifiable, avec revente controlee et QR code dynamique.

A decentralized event ticketing platform on Starknet. Every ticket is a unique NFT with on-chain ownership, controlled resale, and dynamic QR codes.

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
| **Paymaster** | Zero frais blockchain pour l'utilisateur (sponsorise par l'organisateur) |
| **Digital Twin Bridge** | Pont automatique Eventbrite/Weezevent -> NFT Starknet |
| **Securite** | Soulbound, recovery 24h, sessions temporaires, circuit breaker |
| **Tests** | 235 tests automatises (71 Cairo + 164 TypeScript) |
| **CI/CD** | GitHub Actions, 3 pipelines paralleles |

---

## License

MIT
