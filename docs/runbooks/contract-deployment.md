# Runbook: Contract Deployment

Covers deploying SolarProof Soroban contracts to testnet and mainnet.

For full deployment documentation see [docs/DEPLOYMENT.md](../DEPLOYMENT.md).

---

## Prerequisites

- Rust toolchain (see `apps/contracts/rust-toolchain.toml`)
- `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- Stellar CLI: `cargo install --locked stellar-cli --features opt`
- Funded deployer account (testnet: use friendbot; mainnet: real XLM)
- `DEPLOYER_SECRET_KEY` environment variable set

---

## Testnet Deployment

```bash
# 1. Build contracts
cd apps/contracts && stellar contract build

# 2. Deploy (idempotent — skips already-deployed contracts)
DEPLOYER_SECRET_KEY=<secret> bash scripts/deploy-testnet.sh
```

The script writes contract IDs to `scripts/deployments/testnet.json`.

```bash
# 3. Initialize each contract
ADMIN=$(stellar keys address deployer)

stellar contract invoke --id $TOKEN_ID --source deployer --network testnet \
  -- initialize --admin $ADMIN --minter $ADMIN

stellar contract invoke --id $REGISTRY_ID --source deployer --network testnet \
  -- initialize --admin $ADMIN

stellar contract invoke --id $GOV_ID --source deployer --network testnet \
  -- initialize --admin $ADMIN --quorum 51 --voting_period_ledgers 17280

# 4. Update docs/deployments.md with the new contract IDs
# 5. Set contract IDs in .env.local (see docs/DEPLOYMENT.md §2d)
```

---

## Mainnet Deployment

> ⚠️ Irreversible. Use an HSM-backed key. Test on testnet first.

Same steps as testnet — replace `--network testnet` with `--network mainnet` and use `scripts/deploy-mainnet.sh`.

---

## Verify Deployed Bytecode

```bash
# Compute local WASM hash
sha256sum apps/contracts/target/wasm32-unknown-unknown/release/energy_token.wasm

# Compare against on-chain hash at:
# https://stellar.expert/explorer/testnet/contract/<CONTRACT_ID>
# Contract tab → WASM section → WASM hash
```

Hashes must match. A mismatch means the on-chain contract differs from the local build.

---

## Rollback

Soroban contracts are immutable. Rollback = deploy a new contract and update env vars.

1. Deploy corrected WASM → new contract ID
2. Update `NEXT_PUBLIC_ENERGY_TOKEN_ID` (and/or other IDs) in environment
3. Redeploy web app (Vercel picks up new env vars automatically)
4. Update `docs/deployments.md` with new ID and rollback note
5. Do not delete the old contract — it is an audit record

---

## CI / Automated Deployment

Testnet deployment runs automatically on push to `main` via `.github/workflows/deploy-contracts.yml`.

To trigger manually: GitHub → Actions → Deploy Contracts → Run workflow.
