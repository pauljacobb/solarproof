/**
 * Unit tests for Ed25519 signature verification utility (crypto.ts)
 * Issue #112 — 100% coverage of the verification module
 */

import { describe, it, expect } from 'vitest'
import * as ed from '@noble/ed25519'
import { computeReadingHash, verifyReadingSignature } from '@/lib/crypto'
import { kwhToStroops } from '@solarproof/stellar'

async function makeKeypair() {
  const privKey = ed.utils.randomPrivateKey()
  const pubKey = await ed.getPublicKeyAsync(privKey)
  return { privKey, pubKey }
}

async function signReading(
  privKey: Uint8Array,
  meterId: string,
  kwh: number,
  timestamp: number
): Promise<{ sigHex: string; hash: Buffer }> {
  const hash = computeReadingHash(meterId, kwhToStroops(kwh), BigInt(timestamp))
  const sig = await ed.signAsync(hash, privKey)
  return { sigHex: Buffer.from(sig).toString('hex'), hash }
}

describe('Ed25519 signature verification', () => {
  const METER_ID = 'meter-abc-123'
  const KWH = 12.5
  const TIMESTAMP = 1_700_000_000

  it('valid signature returns true', async () => {
    const { privKey, pubKey } = await makeKeypair()
    const { sigHex, hash } = await signReading(privKey, METER_ID, KWH, TIMESTAMP)
    const result = await verifyReadingSignature(sigHex, hash, Buffer.from(pubKey).toString('hex'))
    expect(result).toBe(true)
  })

  it('invalid signature (random bytes) returns false', async () => {
    const { pubKey } = await makeKeypair()
    const hash = computeReadingHash(METER_ID, kwhToStroops(KWH), BigInt(TIMESTAMP))
    const badSigHex = Buffer.alloc(64, 0xab).toString('hex')
    const result = await verifyReadingSignature(badSigHex, hash, Buffer.from(pubKey).toString('hex'))
    expect(result).toBe(false)
  })

  it('tampered payload returns false', async () => {
    const { privKey, pubKey } = await makeKeypair()
    const { sigHex } = await signReading(privKey, METER_ID, KWH, TIMESTAMP)
    const tamperedHash = computeReadingHash(METER_ID, kwhToStroops(KWH + 1), BigInt(TIMESTAMP))
    const result = await verifyReadingSignature(sigHex, tamperedHash, Buffer.from(pubKey).toString('hex'))
    expect(result).toBe(false)
  })

  it('wrong public key returns false', async () => {
    const signer = await makeKeypair()
    const other = await makeKeypair()
    const { sigHex, hash } = await signReading(signer.privKey, METER_ID, KWH, TIMESTAMP)
    const result = await verifyReadingSignature(sigHex, hash, Buffer.from(other.pubKey).toString('hex'))
    expect(result).toBe(false)
  })

  it('malformed signature (wrong length) returns false gracefully', async () => {
    const { pubKey } = await makeKeypair()
    const hash = computeReadingHash(METER_ID, kwhToStroops(KWH), BigInt(TIMESTAMP))
    // 32 bytes (too short) — verifyReadingSignature catches and returns false
    const shortSigHex = Buffer.alloc(32).toString('hex')
    const result = await verifyReadingSignature(shortSigHex, hash, Buffer.from(pubKey).toString('hex'))
    expect(result).toBe(false)
  })

  it('malformed public key (wrong length) returns false gracefully', async () => {
    const { privKey } = await makeKeypair()
    const { sigHex, hash } = await signReading(privKey, METER_ID, KWH, TIMESTAMP)
    const badPubKeyHex = Buffer.alloc(16).toString('hex')
    const result = await verifyReadingSignature(sigHex, hash, badPubKeyHex)
    expect(result).toBe(false)
  })

  it('computeReadingHash is deterministic', () => {
    const h1 = computeReadingHash(METER_ID, kwhToStroops(KWH), BigInt(TIMESTAMP))
    const h2 = computeReadingHash(METER_ID, kwhToStroops(KWH), BigInt(TIMESTAMP))
    expect(h1.toString('hex')).toBe(h2.toString('hex'))
  })

  it('computeReadingHash differs when any field changes', () => {
    const base = computeReadingHash(METER_ID, kwhToStroops(KWH), BigInt(TIMESTAMP))
    const diffMeter = computeReadingHash('other-meter', kwhToStroops(KWH), BigInt(TIMESTAMP))
    const diffKwh = computeReadingHash(METER_ID, kwhToStroops(KWH + 0.1), BigInt(TIMESTAMP))
    const diffTs = computeReadingHash(METER_ID, kwhToStroops(KWH), BigInt(TIMESTAMP + 1))
    expect(base.toString('hex')).not.toBe(diffMeter.toString('hex'))
    expect(base.toString('hex')).not.toBe(diffKwh.toString('hex'))
    expect(base.toString('hex')).not.toBe(diffTs.toString('hex'))
  })
})
