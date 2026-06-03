import { createHash } from 'crypto'
import { verifyAsync } from '@noble/ed25519'

/**
 * Compute the canonical reading hash: `SHA-256(meter_id ‖ kwh_stroops_le ‖ timestamp_le)`
 *
 * This hash is the cryptographic link between the physical meter reading and
 * the on-chain anchor. It **must** match the hash signed by the meter device,
 * so the encoding is fixed and must never change without a protocol version bump:
 *
 * - `meter_id` — UTF-8 encoded, variable length (no padding).
 * - `kwh_stroops` — 64-bit signed integer, **little-endian** (matches the
 *   embedded firmware convention used by the meter hardware).
 * - `timestamp_unix` — 64-bit signed integer, **little-endian**, seconds
 *   since Unix epoch.
 *
 * The little-endian convention is intentional: most embedded targets (ARM
 * Cortex-M) are little-endian, so the firmware can hash the raw memory
 * representation without byte-swapping.
 *
 * @param meterId - Human-readable meter identifier (e.g. `"meter-001"`).
 * @param kwhStroops - Energy reading in stroops (1 kWh = 10^7 stroops).
 * @param timestampUnix - Reading timestamp as Unix seconds.
 * @returns 32-byte SHA-256 digest.
 */
export function computeReadingHash(
  meterId: string,
  kwhStroops: bigint,
  timestampUnix: bigint
): Buffer {
  const meterBytes = Buffer.from(meterId, 'utf8')

  // Allocate 8-byte buffers and write as little-endian int64.
  // BigInt64LE matches the firmware's memory layout on ARM Cortex-M targets.
  const kwhBuf = Buffer.alloc(8)
  kwhBuf.writeBigInt64LE(kwhStroops)

  const tsBuf = Buffer.alloc(8)
  tsBuf.writeBigInt64LE(timestampUnix)

  // Concatenate fields in the canonical order and hash.
  // The order is fixed by the protocol — changing it would invalidate all
  // existing meter signatures.
  return createHash('sha256').update(meterBytes).update(kwhBuf).update(tsBuf).digest()
}

/**
 * Verify an Ed25519 signature over a canonical reading hash.
 *
 * @param signatureHex - 128-char hex-encoded Ed25519 signature (64 bytes).
 * @param readingHash  - 32-byte SHA-256 digest from `computeReadingHash`.
 * @param pubkeyHex    - 64-char hex-encoded Ed25519 public key (32 bytes).
 * @returns `true` if the signature is valid, `false` otherwise (never throws).
 */
export async function verifyReadingSignature(
  signatureHex: string,
  readingHash: Buffer,
  pubkeyHex: string
): Promise<boolean> {
  return verifyAsync(
    Buffer.from(signatureHex, 'hex'),
    readingHash,
    Buffer.from(pubkeyHex, 'hex')
  ).catch(() => false)
}
