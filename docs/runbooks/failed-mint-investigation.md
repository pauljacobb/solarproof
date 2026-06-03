# Runbook: Investigating Failed Mint Jobs

Covers diagnosing and resolving failed energy token mint jobs.

---

## Background

When a meter reading is submitted, the API:
1. Verifies the Ed25519 signature
2. Anchors the reading hash to Stellar via `audit_registry`
3. Mints an `energy_token` (1 token = 1 kWh)

A mint failure means step 3 failed. The reading may still be anchored (step 2 succeeded). Failed mints are recorded in the `mint_jobs` table with a `status` of `failed` and a `diagnosis` field populated by tracer-sim.

---

## Step 1 — Identify the Failed Job

```sql
SELECT id, meter_id, kwh, created_at, status, diagnosis, anchor_tx_hash, mint_tx_hash
FROM mint_jobs
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 20;
```

Check the `diagnosis` field — tracer-sim auto-populates a failure reason when available.

---

## Step 2 — Common Failure Causes

| Diagnosis / symptom | Likely cause | Resolution |
|---|---|---|
| `insufficient_balance` | Minter account out of XLM | Top up the minter account (see Step 3) |
| `contract_not_found` | Wrong contract ID in env | Verify `NEXT_PUBLIC_ENERGY_TOKEN_ID` matches deployed contract |
| `sequence_number_mismatch` | Concurrent mint race | Retry the job (usually self-resolving) |
| `network_timeout` | Stellar RPC unreachable | Check Stellar network status; retry after recovery |
| `signature_invalid` | Minter key mismatch | Verify `MINTER_SECRET_KEY` env var matches the contract's authorized minter |
| `already_minted` | Duplicate job | Check if a successful mint exists for the same `reading_id`; mark job resolved |

---

## Step 3 — Top Up the Minter Account (if needed)

```bash
# Check minter balance
stellar account info --account <MINTER_PUBLIC_KEY> --network testnet

# Testnet: use friendbot
curl "https://friendbot.stellar.org?addr=<MINTER_PUBLIC_KEY>"

# Mainnet: transfer XLM from a funded account
stellar payment send \
  --source <FUNDING_SECRET> \
  --destination <MINTER_PUBLIC_KEY> \
  --amount 100 \
  --network mainnet
```

---

## Step 4 — Retry the Failed Job

```bash
# Trigger a retry via the API (if a retry endpoint exists)
curl -X POST https://<api-host>/api/admin/mint-jobs/<job-id>/retry \
  -H "Authorization: Bearer <admin-token>"
```

Or re-submit the original reading — the server is idempotent for anchoring (returns `409` if already anchored) but will attempt a fresh mint if the previous one failed.

---

## Step 5 — Verify Resolution

```sql
SELECT id, status, mint_tx_hash FROM mint_jobs WHERE id = '<job-id>';
```

Confirm `status = 'completed'` and `mint_tx_hash` is populated.

Verify the on-chain mint at:
```
https://stellar.expert/explorer/testnet/tx/<mint_tx_hash>
```

---

## Step 6 — Escalate if Unresolved

If the failure persists after retrying:
1. Capture the full `diagnosis` text and `anchor_tx_hash`
2. Open an incident (see [incident-response.md](incident-response.md))
3. Check Stellar network status at https://status.stellar.org
4. Review tracer-sim output in application logs for the full replay trace
