# Ed25519 Meter Signing Protocol

This document specifies the signing payload format, key generation procedure, key rotation procedure, and verification algorithm for the SolarProof meter signing protocol. It is intended for hardware integrators building or certifying smart meter devices.

---

## Overview

Every meter reading must be cryptographically signed by the physical device before it is accepted by the SolarProof API. The signature proves that the reading originated from a registered device and has not been tampered with in transit.

The protocol uses **Ed25519** (RFC 8032) — a deterministic, high-performance elliptic-curve signature scheme with 32-byte keys and 64-byte signatures.

```
Meter device
  1. Compute canonical reading hash: SHA-256(meter_id ‖ kwh_stroops_le64 ‖ timestamp_le64)
  2. Sign hash with Ed25519 private key → 64-byte signature
  3. POST { meter_id, kwh, timestamp, signature_hex } to /api/readings

SolarProof API
  4. Look up meter's registered public key
  5. Recompute canonical hash from received fields
  6. Verify Ed25519 signature against hash and public key
  7. Anchor hash on Stellar, mint certificate
```

---

## Signing Payload Format

The signature is computed over a **canonical reading hash**, not over the raw JSON body. This ensures the signature is independent of JSON serialisation differences.

### Canonical hash construction

```
hash = SHA-256( meter_id_utf8 ‖ kwh_stroops_le64 ‖ timestamp_le64 )
```

| Field | Encoding | Size |
|---|---|---|
| `meter_id_utf8` | UTF-8 bytes of the meter UUID string (no null terminator) | variable (36 bytes for a standard UUID) |
| `kwh_stroops_le64` | `round(kwh × 10_000_000)` as a **little-endian signed 64-bit integer** | 8 bytes |
| `timestamp_le64` | Unix epoch seconds as a **little-endian signed 64-bit integer** | 8 bytes |

Fields are concatenated in the order listed above with no separators or padding.

### Why little-endian?

Most embedded targets (ARM Cortex-M) are little-endian. Using little-endian encoding allows the firmware to hash the raw memory representation of integer fields without byte-swapping, reducing code complexity and the risk of endianness bugs.

### Why stroops?

SolarProof uses a fixed scale of **1 kWh = 10,000,000 stroops**, mirroring the Stellar native asset convention (1 XLM = 10^7 stroops). This keeps fractional kWh values representable as integers on-chain and avoids floating-point precision issues.

### Example

For a reading of `12.5 kWh` from meter `a1b2c3d4-e5f6-7890-abcd-ef1234567890` at Unix timestamp `1745500800`:

```
meter_id_utf8   = 61 31 62 32 63 33 64 34 2d 65 35 66 36 2d 37 38
                  39 30 2d 61 62 63 64 2d 65 66 31 32 33 34 35 36
                  37 38 39 30   (36 bytes, UTF-8 of the UUID string)

kwh_stroops     = round(12.5 × 10_000_000) = 125_000_000
                = 0x0773_5940 → little-endian 64-bit: 40 59 73 07 00 00 00 00

timestamp       = 1745500800 = 0x6800_0B00
                → little-endian 64-bit: 00 0b 00 68 00 00 00 00

hash_input      = meter_id_utf8 ‖ kwh_stroops_le64 ‖ timestamp_le64
hash            = SHA-256(hash_input)   → 32 bytes
```

### Reference implementation (Node.js / TypeScript)

```ts
import { createHash } from 'crypto'

function computeReadingHash(
  meterId: string,
  kwhStroops: bigint,
  timestampUnix: bigint
): Buffer {
  const meterBytes = Buffer.from(meterId, 'utf8')
  const kwhBuf = Buffer.alloc(8)
  kwhBuf.writeBigInt64LE(kwhStroops)
  const tsBuf = Buffer.alloc(8)
  tsBuf.writeBigInt64LE(timestampUnix)
  return createHash('sha256').update(meterBytes).update(kwhBuf).update(tsBuf).digest()
}

// Convert kWh to stroops
const kwhStroops = BigInt(Math.round(12.5 * 1e7))  // 125000000n
const hash = computeReadingHash(
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  kwhStroops,
  1745500800n
)
```

The canonical server-side implementation is in `apps/web/src/lib/crypto.ts`. Any compliant firmware implementation must produce identical output.

### Reference implementation (C — embedded)

```c
#include <stdint.h>
#include <string.h>
#include "sha256.h"   /* any compliant SHA-256 library */

/**
 * Compute the SolarProof canonical reading hash.
 *
 * @param meter_id      UTF-8 meter UUID string (no null terminator needed)
 * @param meter_id_len  Length of meter_id in bytes
 * @param kwh_stroops   round(kwh * 10_000_000) as int64
 * @param timestamp     Unix seconds as int64
 * @param out           Output buffer, must be 32 bytes
 */
void solarproof_reading_hash(
    const uint8_t *meter_id, size_t meter_id_len,
    int64_t kwh_stroops,
    int64_t timestamp,
    uint8_t out[32])
{
    sha256_ctx ctx;
    sha256_init(&ctx);
    sha256_update(&ctx, meter_id, meter_id_len);

    /* Little-endian int64 — safe on ARM Cortex-M (LE) */
    sha256_update(&ctx, (uint8_t *)&kwh_stroops, 8);
    sha256_update(&ctx, (uint8_t *)&timestamp, 8);

    sha256_final(&ctx, out);
}
```

> **Note for big-endian targets:** byte-swap `kwh_stroops` and `timestamp` before hashing.

---

## Signing the Hash

Sign the 32-byte canonical hash with the device's Ed25519 private key.

- Algorithm: **Ed25519** (RFC 8032, pure variant — no pre-hashing)
- Input: 32-byte SHA-256 digest (not the raw reading data)
- Output: 64-byte signature, transmitted as a **128-character lowercase hex string**

### Reference implementation (Node.js)

```js
import { createSign } from 'crypto'

function signReading(readingHashBytes, privateKeyHex) {
  // Wrap raw 32-byte key in PKCS#8 DER envelope for Node.js crypto API
  const privKeyDer = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(privateKeyHex, 'hex'),
  ])
  const sign = createSign('ed25519')
  sign.update(readingHashBytes)
  return sign.sign({ key: privKeyDer, format: 'der', type: 'pkcs8' }).toString('hex')
}
```

### Reference implementation (C — using libsodium)

```c
#include <sodium.h>

/* sk: 64-byte Ed25519 secret key (seed ‖ public key, libsodium format) */
void sign_reading(
    const uint8_t hash[32],
    const uint8_t sk[64],
    uint8_t sig_out[64])
{
    unsigned long long sig_len;
    crypto_sign_ed25519_detached(sig_out, &sig_len, hash, 32, sk);
}
```

---

## Example Signed Payload

```json
{
  "meter_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "kwh": 12.5,
  "timestamp": 1745500800,
  "signature_hex": "a3f1c2d4e5b6a7f8091a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4",
  "nonce": "meter-001-1745500800-abc123"
}
```

The `nonce` field is optional but strongly recommended for replay protection. Use a unique value per request (e.g. `<meter_id>-<timestamp>-<random>`).

---

## Hardware Security Modules (HSM)

For production deployments (Level 2+), it is **mandatory** to store the meter's private key in a Hardware Security Module (HSM), Trusted Platform Module (TPM), or Secure Enclave.

### Key Requirements

1. **Non-extractable**: The private key must be generated on-chip and marked as non-extractable.
2. **PKCS#11**: The device should ideally support the PKCS#11 interface for signing.
3. **Ed25519 Support**: The HSM must support the `CKM_EDDSA` mechanism (PKCS#11 v3.0+).

### YubiKey Integration

YubiKey 5 Series devices support Ed25519 via the PIV application. For detailed implementation details, see the [Hardware HSM Integration Guide](HSM_INTEGRATION.md).

---

### Development / simulation

```bash
node scripts/gen-meter-key.mjs
# Writes meter-key.json: { private_key_hex, public_key_hex }
```

The script generates a fresh Ed25519 keypair using Node.js `crypto.generateKeyPairSync('ed25519')` and extracts the raw 32-byte key material from the DER-encoded output.

### Production (hardware)

For production deployments, generate the keypair inside a hardware security module (HSM), TPM, or secure enclave:

1. **Generate** the Ed25519 keypair inside the secure element at manufacture or first boot.
2. **Export only the public key** — the private key must never leave the secure element.
3. **Store the public key** in the SolarProof `meters` table (see Registration below).

Recommended hardware:
- YubiKey 5 series (FIDO2 / PIV)
- Microchip ATECC608B (I²C secure element)
- ARM TrustZone / OP-TEE

### Registering the public key

```bash
# Via the API (requires operator JWT)
curl -X POST https://solarproof.vercel.app/api/meters \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Rooftop Panel A",
    "cooperative_id": "<cooperative-uuid>",
    "serial_number": "SN-001234",
    "pubkey_hex": "<64-char hex public key>"
  }'
```

The API returns the meter's UUID, which must be stored on the device and used as `meter_id` in every reading.

---

## Key Rotation Procedure

Key rotation is required when:
- A device is compromised or suspected of compromise
- A device is replaced or refurbished
- Scheduled rotation policy requires it

### Steps

1. **Generate a new keypair** on the replacement device (or inside the HSM).

2. **Register the new public key** via `POST /api/meters` — this creates a new meter record with a new UUID.

3. **Deactivate the old meter** via `PATCH /api/meters/<old-id>/revoke`. This sets `active=false` and prevents further readings from the old key.

4. **Update the device** with the new meter UUID. All subsequent readings must use the new `meter_id`.

5. **Verify** by submitting a test reading with the new key and confirming it is accepted.

> **Important:** Readings submitted with the old key after revocation will be rejected with `404 Meter not found or inactive`. There is no grace period — rotate atomically.

---

## Verification Algorithm

The SolarProof API verifies each reading as follows:

```
1. Parse and validate the JSON body (meter_id, kwh, timestamp, signature_hex)
2. Reject if timestamp is more than 5 minutes old or more than 1 minute in the future
3. Look up the meter record by meter_id; reject with 404 if not found or inactive
4. Check rate limit: 60 requests/minute per meter public key
5. Compute canonical hash: SHA-256(meter_id_utf8 ‖ kwh_stroops_le64 ‖ timestamp_le64)
6. Decode signature_hex to 64 bytes
7. Verify Ed25519 signature: verify(signature, hash, pubkey_hex)
8. Reject with 401 if signature is invalid
9. Persist reading, anchor hash on Stellar, mint certificate
```

### Independent verification (Node.js)

```js
import { verifyAsync } from '@noble/ed25519'
import { createHash } from 'crypto'

async function verifyReading(reading, meterPubkeyHex) {
  const { meter_id, kwh, timestamp, signature_hex } = reading
  const kwhStroops = BigInt(Math.round(kwh * 1e7))

  const meterBytes = Buffer.from(meter_id, 'utf8')
  const kwhBuf = Buffer.alloc(8); kwhBuf.writeBigInt64LE(kwhStroops)
  const tsBuf = Buffer.alloc(8); tsBuf.writeBigInt64LE(BigInt(timestamp))
  const hash = createHash('sha256').update(meterBytes).update(kwhBuf).update(tsBuf).digest()

  return verifyAsync(
    Buffer.from(signature_hex, 'hex'),
    hash,
    Buffer.from(meterPubkeyHex, 'hex')
  )
}
```

---

## Security Considerations

| Concern | Mitigation |
|---|---|
| Private key theft | Store in HSM/TPM; never log or transmit |
| Replay attacks | Server rejects duplicate reading hashes; use `nonce` field |
| Timestamp manipulation | Server rejects readings >5 min old or >1 min in the future |
| Rate abuse | 60 req/min per meter public key; excess returns 429 |
| Key compromise | Revoke via `PATCH /api/meters/<id>/revoke` immediately |

---

## Related Documents

- `docs/METER_INTEGRATION.md` — hardware integration guide (key generation, registration, submission)
- `docs/adr/001-ed25519-signing.md` — architecture decision record for Ed25519 choice
- `apps/web/src/lib/crypto.ts` — canonical hash implementation
- `scripts/gen-meter-key.mjs` — keypair generation script
- `scripts/send-reading.mjs` — end-to-end signing and submission reference
