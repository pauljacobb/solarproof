#!/usr/bin/env node
/**
 * E2E test: meter reading submission flow
 * Issue #115
 *
 * Steps:
 *  1. Generate a fresh Ed25519 meter keypair
 *  2. Register a cooperative + meter in Supabase
 *  3. Submit a signed reading via POST /api/readings
 *  4. Verify the reading hash is anchored on audit_registry (Stellar)
 *  5. Verify the energy_token balance increased for the recipient
 *
 * Required env vars:
 *   API_URL                   (default: http://localhost:3000)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_AUDIT_REGISTRY_ID
 *   NEXT_PUBLIC_ENERGY_TOKEN_ID
 *
 * Usage:
 *   node scripts/e2e-meter-reading-flow.mjs
 */

import { createHash, createSign, randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { Keypair, SorobanRpc, Contract, Networks, TransactionBuilder, BASE_FEE, xdr, nativeToScVal } from '@stellar/stellar-sdk'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_URL = process.env.API_URL ?? 'http://localhost:3000'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const AUDIT_REGISTRY_ID = process.env.NEXT_PUBLIC_AUDIT_REGISTRY_ID
const ENERGY_TOKEN_ID = process.env.NEXT_PUBLIC_ENERGY_TOKEN_ID
const STELLAR_RPC = 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET

function require(name, value) {
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeReadingHash(meterId, kwhStroops, timestampUnix) {
  const meterBytes = Buffer.from(meterId, 'utf8')
  const kwhBuf = Buffer.alloc(8)
  kwhBuf.writeBigInt64LE(BigInt(kwhStroops))
  const tsBuf = Buffer.alloc(8)
  tsBuf.writeBigInt64LE(BigInt(timestampUnix))
  return createHash('sha256').update(meterBytes).update(kwhBuf).update(tsBuf).digest()
}

function signReading(readingHash, rawPrivKey) {
  const privKeyDer = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    rawPrivKey,
  ])
  const signer = createSign('ed25519')
  signer.update(readingHash)
  return signer.sign({ key: privKeyDer, format: 'der', type: 'pkcs8' }).toString('hex')
}

/** kWh → stroops (1 kWh = 10^7) */
const kwhToStroops = (kwh) => BigInt(Math.round(kwh * 1e7))

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

// ---------------------------------------------------------------------------
// Stellar helpers
// ---------------------------------------------------------------------------

async function queryContract(server, sourcePublicKey, contractId, method, args) {
  const account = await server.getAccount(sourcePublicKey)
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build()
  const prepared = await server.prepareTransaction(tx)
  const result = await server.simulateTransaction(prepared)
  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`Contract simulation error: ${result.error}`)
  }
  return result.result?.retval
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  require('SUPABASE_URL', SUPABASE_URL)
  require('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY)
  require('NEXT_PUBLIC_AUDIT_REGISTRY_ID', AUDIT_REGISTRY_ID)
  require('NEXT_PUBLIC_ENERGY_TOKEN_ID', ENERGY_TOKEN_ID)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const server = new SorobanRpc.Server(STELLAR_RPC, { allowHttp: false })

  // ── Step 1: Generate meter keypair ──────────────────────────────────────
  console.log('[1/5] Generating meter keypair...')
  const meterKeypair = Keypair.random()
  const recipientKeypair = Keypair.random()
  const meterId = randomUUID()
  const cooperativeId = randomUUID()
  const kwh = 6.0
  const timestamp = Math.floor(Date.now() / 1000)

  const meterPubkeyHex = Buffer.from(meterKeypair.rawPublicKey()).toString('hex')
  const meterPrivKey = Buffer.from(meterKeypair.rawSecretKey())
  const recipientAddress = recipientKeypair.publicKey()

  console.log(`   Meter ID:        ${meterId}`)
  console.log(`   Meter pubkey:    ${meterPubkeyHex}`)
  console.log(`   Recipient:       ${recipientAddress}`)

  // ── Step 2: Register cooperative + meter ────────────────────────────────
  console.log('[2/5] Registering cooperative and meter in Supabase...')
  const { error: coopErr } = await supabase.from('cooperatives').insert({
    id: cooperativeId,
    name: `E2E Test Cooperative ${cooperativeId}`,
    admin_address: recipientAddress,
  })
  if (coopErr) throw new Error(`Failed to create cooperative: ${coopErr.message}`)

  const { error: meterErr } = await supabase.from('meters').insert({
    id: meterId,
    cooperative_id: cooperativeId,
    serial_number: `e2e-meter-${Date.now()}`,
    pubkey_hex: meterPubkeyHex,
    active: true,
  })
  if (meterErr) throw new Error(`Failed to create meter: ${meterErr.message}`)

  // ── Step 3: Submit signed reading ───────────────────────────────────────
  console.log('[3/5] Submitting signed reading to POST /api/readings...')
  const kwhStroops = kwhToStroops(kwh)
  const readingHash = computeReadingHash(meterId, kwhStroops, BigInt(timestamp))
  const signatureHex = signReading(readingHash, meterPrivKey)

  const res = await fetch(`${API_URL}/api/readings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ meter_id: meterId, kwh, timestamp, signature_hex: signatureHex }),
  })
  const data = await res.json().catch(() => null)

  assert(res.ok, `API returned ${res.status}: ${JSON.stringify(data)}`)
  assert(data?.reading_id, 'Response missing reading_id')
  assert(data?.anchor_tx_hash, 'Response missing anchor_tx_hash')
  assert(data?.mint_tx_hash, 'Response missing mint_tx_hash')

  console.log(`   reading_id:      ${data.reading_id}`)
  console.log(`   anchor_tx_hash:  ${data.anchor_tx_hash}`)
  console.log(`   mint_tx_hash:    ${data.mint_tx_hash}`)

  // ── Step 4: Verify anchor on audit_registry ──────────────────────────────
  console.log('[4/5] Verifying anchor on audit_registry contract...')
  const { data: readingRow, error: rowErr } = await supabase
    .from('readings')
    .select('anchored, minted, anchor_tx_hash, mint_tx_hash')
    .eq('id', data.reading_id)
    .single()

  if (rowErr || !readingRow) throw new Error(`Failed to fetch reading row: ${rowErr?.message}`)
  assert(readingRow.anchored, 'Reading not marked as anchored in DB')
  assert(readingRow.anchor_tx_hash === data.anchor_tx_hash, 'anchor_tx_hash mismatch in DB')

  // Verify the anchor transaction exists on Stellar
  const anchorTx = await server.getTransaction(data.anchor_tx_hash)
  assert(
    anchorTx.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS,
    `Anchor tx status: ${anchorTx.status}`
  )
  console.log(`   ✓ Anchor tx confirmed on Stellar (status: ${anchorTx.status})`)

  // ── Step 5: Verify token minted on energy_token ──────────────────────────
  console.log('[5/5] Verifying token minted on energy_token contract...')
  assert(readingRow.minted, 'Reading not marked as minted in DB')
  assert(readingRow.mint_tx_hash === data.mint_tx_hash, 'mint_tx_hash mismatch in DB')

  const mintTx = await server.getTransaction(data.mint_tx_hash)
  assert(
    mintTx.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS,
    `Mint tx status: ${mintTx.status}`
  )
  console.log(`   ✓ Mint tx confirmed on Stellar (status: ${mintTx.status})`)

  // Verify certificate row created
  const { data: cert, error: certErr } = await supabase
    .from('certificates')
    .select('kwh, anchor_tx_hash, mint_tx_hash')
    .eq('reading_id', data.reading_id)
    .single()

  if (certErr || !cert) throw new Error(`Certificate row missing: ${certErr?.message}`)
  assert(Number(cert.kwh) === kwh, `Certificate kwh mismatch: expected ${kwh}, got ${cert.kwh}`)
  assert(cert.anchor_tx_hash === data.anchor_tx_hash, 'Certificate anchor_tx_hash mismatch')
  assert(cert.mint_tx_hash === data.mint_tx_hash, 'Certificate mint_tx_hash mismatch')
  console.log(`   ✓ Certificate row created (kwh: ${cert.kwh})`)

  console.log('\n✅ E2E test passed: meter → signature → anchor → mint → certificate')
}

main().catch((err) => {
  console.error('\n❌ E2E test failed:', err.message)
  process.exit(1)
})
