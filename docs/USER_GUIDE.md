# SolarProof Dashboard — User Guide

> **Audience:** Energy producers and cooperatives using the SolarProof web dashboard.  
> **Live app:** [https://solarproof.vercel.app](https://solarproof.vercel.app)

---

## Table of Contents

1. [Connecting Your Wallet](#1-connecting-your-wallet)
2. [Dashboard Overview](#2-dashboard-overview)
3. [Submitting Meter Readings](#3-submitting-meter-readings)
4. [Viewing Certificates](#4-viewing-certificates)
5. [Retiring Certificates](#5-retiring-certificates)
6. [Participating in Governance](#6-participating-in-governance)
7. [Verifying a Certificate](#7-verifying-a-certificate)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Connecting Your Wallet

SolarProof uses [Freighter](https://www.freighter.app/) — a Stellar browser wallet — to sign transactions.

**Prerequisites**

- Freighter browser extension installed ([freighter.app](https://www.freighter.app/))
- Freighter set to **Testnet** (Settings → Network → Testnet)
- Your Stellar account funded with at least 1 XLM (use [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#account-creator?network=test) for testnet)

**Steps**

1. Open the SolarProof dashboard at `/dashboard`.
2. Click **Connect Wallet** in the top-right corner of the navigation bar.
3. Freighter will prompt you to approve the connection — click **Approve**.
4. Your truncated public key (e.g. `GABC…XYZ`) appears in the navbar, confirming you are connected.

> **Screenshot placeholder:** `docs/screenshots/01-connect-wallet.png`  
> *(Shows the navbar with the Connect Wallet button highlighted, then the connected state with the public key displayed.)*

**Disconnecting**

Click your public key in the navbar and select **Disconnect**.

---

## 2. Dashboard Overview

Navigate to **Dashboard** (`/dashboard`) to see a real-time summary of your energy activity.

| Section | What it shows |
|---|---|
| **Total energy** | Cumulative kWh across all verified meter readings |
| **Certificates issued** | Number of energy tokens minted on Stellar (1 token = 1 kWh) |
| **Certificates retired** | Tokens permanently burned to claim renewable energy usage |
| **Active meters** | Meters that have reported in the last 24 hours |
| **Daily energy output chart** | Area chart of kWh over the last 14 days |
| **Verification status chart** | Verified vs. pending readings per meter |
| **Recent readings table** | Last 20 meter readings with status badges |

> **Screenshot placeholder:** `docs/screenshots/02-dashboard-overview.png`  
> *(Shows the full dashboard with stat cards, both charts, and the readings table.)*

A **Verified** badge (green) means the reading's Ed25519 signature has been confirmed and the hash anchored on Stellar. A **Pending** badge (yellow) means verification is in progress.

---

## 3. Submitting Meter Readings

Meter readings can be submitted in two ways: via the UI form or programmatically via the API.

### Via the UI (Meters page)

1. Navigate to **Meters** (`/meters`).
2. Click **Submit Reading**.
3. Fill in the form:
   - **Meter ID** — the unique identifier of your device
   - **kWh** — energy generated since the last reading
   - **Timestamp** — defaults to now; adjust if back-filling
4. Click **Submit**. The dashboard signs the reading with your connected wallet and posts it to `/api/readings`.
5. The new reading appears in the **Recent readings** table on the Dashboard with a **Pending** badge. It turns **Verified** once the API confirms the Ed25519 signature and anchors the hash on Stellar (usually within a few seconds).

> **Screenshot placeholder:** `docs/screenshots/03-submit-reading-form.png`  
> *(Shows the Submit Reading modal with the three fields filled in and the Submit button.)*

### Via the API (automated / hardware meters)

```bash
# Generate a meter keypair once
node scripts/gen-meter-key.mjs

# Send a signed reading
node scripts/send-reading.mjs --kwh 12.5 --meter-key ./meter-key.json
```

See [docs/API.md](./API.md) for the full `POST /api/readings` specification.

---

## 4. Viewing Certificates

Each verified reading automatically mints an energy token (SEP-41) on Stellar — one token per kWh.

1. Navigate to **Certificates** (`/certificates`).
2. The list shows all certificates associated with your wallet, including:
   - **Certificate ID** — the on-chain token identifier
   - **kWh** — energy amount represented
   - **Issued** — date minted
   - **Status** — Active or Retired
3. Click a certificate row to open the detail view, which shows:
   - The originating meter reading
   - The Stellar transaction hash (links to Stellar Explorer)
   - The Ed25519 signature of the source reading
   - The audit registry anchor hash

> **Screenshot placeholder:** `docs/screenshots/04-certificates-list.png`  
> *(Shows the certificates list with columns for ID, kWh, Issued date, and Status.)*

> **Screenshot placeholder:** `docs/screenshots/05-certificate-detail.png`  
> *(Shows the certificate detail page with the full chain of custody: meter → signature → ledger anchor → token.)*

---

## 5. Retiring Certificates

Retiring a certificate permanently burns the token on-chain, proving you have claimed the renewable energy for a specific period. This action is **irreversible**.

1. Navigate to **Certificates** (`/certificates`).
2. Find the certificate you want to retire and click **Retire**.
3. A confirmation dialog appears showing the certificate ID and kWh amount.
4. Click **Confirm Retire**. Freighter will prompt you to sign the transaction.
5. Approve the transaction in Freighter.
6. The certificate status changes to **Retired** and the token is burned on Stellar.

> **Screenshot placeholder:** `docs/screenshots/06-retire-confirmation.png`  
> *(Shows the retire confirmation dialog with the certificate details and the Confirm Retire button.)*

> **Note:** Retired certificates remain visible in the list with a **Retired** badge for audit purposes. They can be independently verified at `/verify`.

---

## 6. Participating in Governance

SolarProof cooperatives use on-chain governance to vote on proposals (e.g. fee changes, new meter policies).

### Viewing proposals

1. Navigate to **Governance** (`/governance`).
2. The proposals list shows:
   - **Title** and description
   - **Status** — Active, Passed, Rejected, or Executed
   - **Voting deadline**
   - **Current vote tally** (For / Against)

> **Screenshot placeholder:** `docs/screenshots/07-governance-proposals.png`  
> *(Shows the governance page with a list of proposals and their statuses.)*

### Voting on a proposal

1. Click a proposal with **Active** status to open its detail page.
2. Review the full description and any attached discussion.
3. Click **Vote For** or **Vote Against**.
4. Freighter prompts you to sign the vote transaction — click **Approve**.
5. Your vote is recorded on-chain. The tally updates immediately.

> **Screenshot placeholder:** `docs/screenshots/08-vote-on-proposal.png`  
> *(Shows the proposal detail page with the Vote For / Vote Against buttons and the live tally.)*

### Creating a proposal

1. On the **Governance** page, click **New Proposal**.
2. Fill in the **Title** and **Description**.
3. Click **Submit Proposal**. Freighter will prompt you to sign.
4. The proposal appears in the list with **Active** status and is open for voting immediately.

> **Note:** Voting power is proportional to the number of active energy tokens held by your wallet at the time of the vote snapshot.

---

## 7. Verifying a Certificate

Anyone — including regulators and buyers — can verify a certificate without logging in.

1. Navigate to **Verify** (`/verify`).
2. Enter a **Certificate ID** or **Stellar transaction hash**.
3. Click **Verify**.
4. The result shows the full chain of custody:
   - Meter reading (kWh, timestamp, meter ID)
   - Ed25519 signature validity
   - Stellar ledger anchor (audit registry transaction)
   - Certificate mint transaction
   - Retirement transaction (if retired)

> **Screenshot placeholder:** `docs/screenshots/09-verify-result.png`  
> *(Shows the verify page with a certificate ID entered and the full chain-of-custody result expanded.)*

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "Connect Wallet" button does nothing | Freighter not installed | Install from [freighter.app](https://www.freighter.app/) |
| Transaction fails with "insufficient funds" | Account has < 1 XLM | Fund via [Friendbot](https://laboratory.stellar.org/#account-creator?network=test) (testnet) |
| Reading stays **Pending** indefinitely | Signature verification failed | Check that the meter key matches the registered meter ID |
| Certificate not appearing after reading | Minting delay or failed mint | Check the Stellar transaction in the dashboard; see [tracer-sim auto-diagnosis](./API.md#error-handling) |
| Governance vote not registering | Wallet not connected or wrong network | Reconnect Freighter and ensure it is set to Testnet |

For further help, open an issue at [github.com/AnnabelJoe/solarproof/issues](https://github.com/AnnabelJoe/solarproof/issues).

---

*SolarProof Contributors 2026 · Apache-2.0*
