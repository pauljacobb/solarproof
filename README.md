# SolarProof

> End-to-end cryptographic proof of renewable energy — from physical meter to on-chain certificate.

[![CI](https://github.com/AnnabelJoe/solarproof/actions/workflows/ci.yml/badge.svg)](https://github.com/AnnabelJoe/solarproof/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/AnnabelJoe/solarproof/branch/main/graph/badge.svg)](https://codecov.io/gh/AnnabelJoe/solarproof)
[![License](https://img.shields.io/badge/License-Apache%202.0-green)](LICENSE)
[![Stellar](https://img.shields.io/badge/Stellar-Soroban-blue?logo=stellar)](https://stellar.org)
[![Tests](https://img.shields.io/badge/Tests-passing-brightgreen)](#)

**SolarProof** closes the gap between physical energy generation and verifiable on-chain certification. Every kilowatt-hour is signed at the meter, anchored to Stellar, and publicly auditable — no trust required.

---

## The problem

Existing renewable energy certificate systems (I-REC, TIGR, Energy Web) have a critical weakness: **there is no cryptographic link between the physical meter reading and the on-chain certificate**. Anyone can mint a certificate. Nobody can prove it corresponds to real generation.

SolarProof fixes this with three guarantees:

1. **Signed at source** — each meter reading is Ed25519-signed by the device before leaving the hardware
2. **Anchored on-chain** — the signed reading hash is recorded on Stellar alongside the minted certificate
3. **Publicly verifiable** — any regulator, buyer, or auditor can verify the full chain: `meter → signature → ledger → certificate → retirement`

---

## Architecture

```
Smart Meter (Ed25519 keypair)
        │  POST /api/readings  { kwh, timestamp, signature }
        ▼
SolarProof API (Next.js)
        │  1. Verify Ed25519 signature
        │  2. Anchor reading hash to Stellar (audit_registry contract)
        │  3. Mint energy_token (1 token = 1 kWh)
        │  4. If mint fails → tracer-sim auto-diagnosis
        ▼
Stellar Testnet (Soroban)
        ├── energy_token        — SEP-41 certificate token
        ├── audit_registry      — immutable signed-reading anchors
        └── community_governance — cooperative proposals + voting
        ▼
Public Verifier  (https://solarproof.vercel.app/verify)
        │  Input: certificate ID or tx hash
        │  Output: full chain of custody
        └── meter reading → Ed25519 proof → ledger anchor → certificate → retirement
```

---

## What makes it unique

| Feature | SolarProof | I-REC | Energy Web |
|---|---|---|---|
| Cryptographic meter proof | ✅ Ed25519 | ❌ | ❌ |
| On-chain audit anchor | ✅ Soroban | ❌ | Partial |
| Auto-debugging failed mints | ✅ tracer-sim | ❌ | ❌ |
| Public verifier (no login) | ✅ | ❌ | ❌ |
| Open source | ✅ Apache-2.0 | ❌ | Partial |

---

## Smart Contracts (Soroban)

Deployed on Stellar Testnet:

| Contract | Purpose |
|---|---|
| `energy_token` | SEP-41 certificate token (1 token = 1 kWh) |
| `audit_registry` | Immutable anchor of signed meter readings |
| `community_governance` | Cooperative governance (proposals + voting) |

Built with **Soroban SDK 23.1.0** and **OpenZeppelin Stellar v0.5.1**.

---

## Quick Start

### Prerequisites

- Node.js v22+
- pnpm v10+
- Rust + Cargo
- [Stellar CLI](https://developers.stellar.org/docs/tools/stellar-cli)

### Install

```bash
git clone https://github.com/AnnabelJoe/solarproof.git
cd solarproof
pnpm install
```

### Run

```bash
pnpm dev        # Next.js on http://localhost:3000
```

### Contracts

```bash
cd apps/contracts
stellar contract build
cargo test
```

### Docker (recommended for local development)

Spin up the full stack — Next.js, Supabase, and Redis — with a single command:

```bash
cp apps/web/.env.example .env.local   # fill in your values
docker compose up
```

The web app will be available at http://localhost:3000.

Data is persisted in named Docker volumes (`supabase_data`, `redis_data`) so it survives container restarts.

To stop and remove containers (volumes are kept):

```bash
docker compose down
```

### Simulate a meter reading

```bash
# Generate a meter keypair
node scripts/gen-meter-key.mjs

# Send a signed reading
node scripts/send-reading.mjs --kwh 12.5 --meter-key ./meter-key.json
```

---

## Monorepo Structure

```
solarproof/
├── apps/
│   ├── contracts/
│   │   ├── energy_token/
│   │   ├── audit_registry/
│   │   └── community_governance/
│   └── web/                    # Next.js dashboard + API + public verifier
├── packages/
│   └── stellar/                # Shared Stellar utilities
├── scripts/                    # Meter simulation scripts
├── docs/
└── .github/
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Stellar (Soroban) |
| Smart Contracts | Rust + OpenZeppelin Stellar v0.5.1 |
| Frontend | Next.js 15 + React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| Wallet | Freighter + Stellar Wallets Kit |
| Backend | Next.js API Routes + Supabase |
| Signing | Ed25519 (meter devices) |
| Debugging | tracer-sim (Soroban replay) |
| Deployment | Vercel |
| Monorepo | Turborepo + pnpm |

---

## Product Levels

| Level | What | Status |
|---|---|---|
| 1 | Signed meter readings + on-chain anchoring | ✅ Current |
| 2 | Hardware HSM integration (YubiKey / TPM) | ✅ Completed |
| 3 | I-REC / Energy Web / TIGR bridge | 🔜 Next |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs target `develop`.

See [CHANGELOG.md](CHANGELOG.md) for a history of notable changes.

---

## License

Apache-2.0 — See [LICENSE](LICENSE).

---

*Built on Stellar · SolarProof Contributors 2026*
