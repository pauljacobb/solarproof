# Meter Device Integration Guide

This guide explains how hardware manufacturers can integrate their smart meters with SolarProof's signing and submission protocol.

---

## Overview

Each meter must:

1. Hold a persistent Ed25519 keypair (provisioned at manufacture or first boot)
2. Register its public key in the SolarProof database
3. Sign every reading before transmission using the canonical hash format
4. POST the signed reading to `/api/readings`

---

## 1. Key Generation

Generate an Ed25519 keypair and store it securely on the device (HSM, TPM, or secure enclave recommended for production).

**Reference implementation** — `scripts/gen-meter-key.mjs`:

```bash
node scripts/gen-meter-key.mjs
# Writes meter-key.json: { private_key_hex, public_key_hex }
```

The script uses Node.js `crypto.generateKeyPairSync('ed25519')` and extracts the raw 32-byte key material from the DER-encoded output.

**Register the public key** in the `meters` table (Supabase):

```sql
INSERT INTO meters (id, pubkey_hex, cooperative_id, active)
VALUES ('<uuid>', '<64-char hex public key>', '<cooperative-uuid>', true);
```

---

## 2. Reading Payload Format

Every reading submitted to the API must include:

| Field | Type | Description |
|---|---|---|
| `meter_id` | UUID string | The meter's registered UUID |
| `kwh` | number (float) | Energy generated, in kilowatt-hours |
| `timestamp` | integer | Unix epoch seconds (UTC) |
| `signature_hex` | string (128 hex chars) | Ed25519 signature over the canonical reading hash |

**Example payload:**

```json
{
  "meter_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "kwh": 12.5,
  "timestamp": 1745500800,
  "signature_hex": "a3f1...c9e2"
}
```

---

## 3. Canonical Reading Hash

The signature must be computed over a deterministic SHA-256 hash of the reading. The canonical hash is:

```
SHA-256( meter_id_utf8 || kwh_stroops_le64 || timestamp_le64 )
```

Where:
- `meter_id_utf8` — the meter UUID as a UTF-8 byte string
- `kwh_stroops_le64` — `round(kwh × 10_000_000)` as a little-endian 64-bit signed integer
- `timestamp_le64` — Unix seconds as a little-endian 64-bit signed integer

**Reference implementation** (Node.js):

```js
import { createHash } from 'crypto'

function computeReadingHash(meterId, kwh, timestamp) {
  const kwhStroops = BigInt(Math.round(kwh * 1e7))
  const meterBytes = Buffer.from(meterId, 'utf8')
  const kwhBuf = Buffer.alloc(8)
  kwhBuf.writeBigInt64LE(kwhStroops)
  const tsBuf = Buffer.alloc(8)
  tsBuf.writeBigInt64LE(BigInt(timestamp))
  return createHash('sha256').update(meterBytes).update(kwhBuf).update(tsBuf).digest()
}
```

The server-side implementation lives in `apps/web/src/lib/crypto.ts` and uses the same algorithm — any compliant implementation must produce identical output.

---

## 4. Signing the Reading

Sign the 32-byte reading hash with the device's Ed25519 private key. The resulting signature must be 64 bytes, transmitted as a 128-character lowercase hex string.

**Reference implementation** (Node.js):

```js
import { createSign } from 'crypto'

function signReading(readingHash, privateKeyHex) {
  // Wrap raw 32-byte key in PKCS#8 DER envelope
  const privKeyDer = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(privateKeyHex, 'hex'),
  ])
  const sign = createSign('ed25519')
  sign.update(readingHash)
  const sig = sign.sign({ key: privKeyDer, format: 'der', type: 'pkcs8' })
  return sig.toString('hex')
}
```

See `scripts/send-reading.mjs` for the complete end-to-end reference.

---

## 5. Submitting a Reading

```
POST /api/readings
Content-Type: application/json
```

**Request body:** see [Section 2](#2-reading-payload-format).

**Success response — `201 Created`:**

```json
{
  "reading_id": "<uuid>",
  "anchor_tx_hash": "<64-char hex>",
  "mint_tx_hash": "<64-char hex>"
}
```

**Error responses:**

| Status | Meaning |
|---|---|
| `400` | Malformed payload or validation failure |
| `401` | Invalid Ed25519 signature |
| `404` | Meter not found or inactive |
| `409` | Reading already anchored (duplicate) |
| `500` | Stellar transaction failure |

---

## 6. End-to-End Test with the Reference Scripts

```bash
# 1. Generate a keypair (one-time per meter)
node scripts/gen-meter-key.mjs

# 2. Register the public key in Supabase (see Section 1)

# 3. Send a signed reading
node scripts/send-reading.mjs \
  --meter-id <your-meter-uuid> \
  --kwh 12.5 \
  --key ./meter-key.json \
  --api http://localhost:3000
```

---

## 7. Security Considerations

- Store the private key in a hardware security module (HSM) or TPM in production. Never log or transmit it.
- Use a monotonically increasing timestamp to prevent replay attacks. The server rejects duplicate reading hashes.
- Rotate keys by registering a new public key and deactivating the old meter record.
- For hardware HSM integration (YubiKey / TPM), see the [Hardware HSM Integration Guide](HSM_INTEGRATION.md).
