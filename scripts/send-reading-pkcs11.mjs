#!/usr/bin/env node
/**
 * scripts/send-reading-pkcs11.mjs
 *
 * Reference implementation for sending a signed reading using a Hardware HSM (via PKCS#11).
 * Specifically tested with YubiKey 5 Series.
 *
 * Prerequisites:
 *   1. Install pkcs11js: `pnpm add pkcs11js` (or npm install)
 *   2. Install YKCS11 middleware (see docs/HSM_INTEGRATION.md)
 *
 * Usage:
 *   export PKCS11_LIB="/usr/lib/x86_64-linux-gnu/libykcs11.so"
 *   export PKCS11_PIN="123456"
 *   node scripts/send-reading-pkcs11.mjs \
 *     --meter-id <uuid> \
 *     --kwh 12.5 \
 *     --api http://localhost:3000
 */

import { createHash } from 'crypto';
import pkcs11js from 'pkcs11js';

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null };

const meterId = get('--meter-id') ?? 'test-meter-id';
const kwh = parseFloat(get('--kwh') ?? '10');
const api = get('--api') ?? 'http://localhost:3000';

const PKCS11_LIB = process.env.PKCS11_LIB;
const PIN = process.env.PKCS11_PIN;

if (!PKCS11_LIB || !PIN) {
  console.error('Error: PKCS11_LIB and PKCS11_PIN environment variables must be set.');
  process.exit(1);
}

// --- 1. Compute Canonical Reading Hash ---
const timestamp = Math.floor(Date.now() / 1000);
const kwhStroops = BigInt(Math.round(kwh * 1e7));

const meterBytes = Buffer.from(meterId, 'utf8');
const kwhBuf = Buffer.alloc(8); kwhBuf.writeBigInt64LE(kwhStroops);
const tsBuf = Buffer.alloc(8); tsBuf.writeBigInt64LE(BigInt(timestamp));
const readingHash = createHash('sha256').update(meterBytes).update(kwhBuf).update(tsBuf).digest();

console.log('Reading hash:', readingHash.toString('hex'));

// --- 2. Sign with Hardware HSM ---
let signatureHex;

try {
  const pkcs11 = new pkcs11js.PKCS11();
  pkcs11.load(PKCS11_LIB);
  pkcs11.C_Initialize();

  // Find slot with YubiKey
  const slots = pkcs11.C_GetSlotList(true);
  if (slots.length === 0) throw new Error('No PKCS#11 slots found');
  const slot = slots[0];

  const session = pkcs11.C_OpenSession(slot, pkcs11js.CKF_SERIAL_SESSION | pkcs11js.CKF_RW_SESSION);
  pkcs11.C_Login(session, pkcs11js.CKU_USER, PIN);

  // Find the Ed25519 private key
  // YubiKey PIV Slot 9c maps to CKA_ID = 02
  pkcs11.C_FindObjectsInit(session, [
    { type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_PRIVATE_KEY },
    { type: pkcs11js.CKA_ID, value: Buffer.from([0x02]) }
  ]);
  const keyHandle = pkcs11.C_FindObjects(session, 1)[0];
  pkcs11.C_FindObjectsFinal(session);

  if (!keyHandle) throw new Error('Private key handle not found in slot 9c (ID 02)');

  // Sign using EdDSA mechanism
  pkcs11.C_SignInit(session, { mechanism: pkcs11js.CKM_EDDSA }, keyHandle);
  const signature = pkcs11.C_Sign(session, readingHash, Buffer.alloc(64));
  
  signatureHex = signature.toString('hex');
  console.log('HSM Signature generated successfully.');

  pkcs11.C_Logout(session);
  pkcs11.C_CloseSession(session);
  pkcs11.C_Finalize();
} catch (err) {
  console.error('HSM Signing Error:', err.message);
  process.exit(1);
}

// --- 3. Submit to API ---
const body = {
  meter_id: meterId,
  kwh,
  timestamp,
  signature_hex: signatureHex,
  nonce: `hsm-${meterId}-${timestamp}-${Math.floor(Math.random() * 1000000)}`,
};

console.log('Sending reading to API:', { meterId, kwh, timestamp });

try {
  const res = await fetch(`${api}/api/readings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log(res.ok ? '✓ Success:' : '✗ Error:', data);
} catch (err) {
  console.error('API Error:', err.message);
}
