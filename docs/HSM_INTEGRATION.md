# Hardware HSM Integration Guide (Level 2)

This guide explains how to use a Hardware Security Module (HSM), such as a **YubiKey 5 Series** or a **TPM**, to securely sign SolarProof meter readings.

Using an HSM ensures that the private key **never leaves the hardware**, providing Level 2 security compliance for the SolarProof roadmap.

---

## 1. Prerequisites

- **Hardware**: YubiKey 5 Series (supports Ed25519 in PIV)
- **Middleware**: Yubico PIV Tool (includes `ykcs11` module)
- **Library**: `pkcs11js` (for Node.js integration)

### Installing YKCS11

| OS | Installation | Module Path |
|---|---|---|
| **Ubuntu/Debian** | `sudo apt install yubico-piv-tool` | `/usr/lib/x86_64-linux-gnu/libykcs11.so` |
| **macOS** | `brew install yubico-piv-tool` | `/usr/local/lib/libykcs11.dylib` |
| **Windows** | [Yubico PIV Tool MSI](https://developers.yubico.com/yubico-piv-tool/Releases/) | `C:\Program Files\Yubico\Yubico PIV Tool\bin\ykcs11.dll` |

---

## 2. Provisioning the YubiKey

You must generate an Ed25519 keypair in one of the PIV slots (e.g., slot `9c` for digital signatures).

### Step 1: Generate Key on YubiKey

```bash
# Generate Ed25519 key in slot 9c
yubico-piv-tool -s 9c -a generate -A ED25519 -o public.pem
```

### Step 2: Create a Self-Signed Certificate

YubiKey requires a certificate to be present in the slot for some PKCS#11 modules to "see" the key.

```bash
# Create self-signed cert for the key in 9c
yubico-piv-tool -a verify-pin -a selfsign-certificate -s 9c -S "/CN=SolarProof Meter/" -i public.pem -o cert.pem

# Import the certificate back to the YubiKey
yubico-piv-tool -a import-certificate -s 9c -i cert.pem
```

### Step 3: Register Public Key in SolarProof

Extract the raw 32-byte public key hex:

```bash
openssl pkey -pubin -in public.pem -outform DER | tail -c 32 | xxd -p -c 32
```

Register this hex string in the `meters.pubkey_hex` column in Supabase.

---

## 3. Signing Readings via PKCS#11

The following reference implementation uses `pkcs11js` to interact with the YubiKey.

### Reference Script: `scripts/send-reading-pkcs11.mjs`

```javascript
import pkcs11js from 'pkcs11js';
import { createHash } from 'crypto';

// Configuration
const PKCS11_LIB = process.env.PKCS11_LIB || '/usr/lib/x86_64-linux-gnu/libykcs11.so';
const PIN = process.env.PKCS11_PIN || '123456';
const SLOT_ID = 0; // Usually 0 for YubiKey

const pkcs11 = new pkcs11js.PKCS11();
pkcs11.load(PKCS11_LIB);
pkcs11.C_Initialize();

try {
  const session = pkcs11.C_OpenSession(SLOT_ID, pkcs11js.CKF_SERIAL_SESSION | pkcs11js.CKF_RW_SESSION);
  pkcs11.C_Login(session, pkcs11js.CKU_USER, PIN);

  // Find the Ed25519 private key in slot 9c
  // YubiKey YKCS11 maps PIV slot 9c to CKA_ID = 0x02
  const keys = pkcs11.C_FindObjectsInit(session, [
    { type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_PRIVATE_KEY },
    { type: pkcs11js.CKA_ID, value: Buffer.from([0x02]) } 
  ]);
  const keyHandle = pkcs11.C_FindObjects(session, 1)[0];
  pkcs11.C_FindObjectsFinal(session);

  if (!keyHandle) throw new Error("Key not found in slot 9c");

  // 1. Prepare the reading hash (canonical format)
  const readingHash = computeReadingHash(meterId, kwh, timestamp);

  // 2. Sign the hash using the HSM
  // Note: Ed25519 in PKCS#11 uses CKM_EDDSA
  pkcs11.C_SignInit(session, { mechanism: pkcs11js.CKM_EDDSA }, keyHandle);
  const signature = pkcs11.C_Sign(session, readingHash, Buffer.alloc(64));

  console.log("Signature (HSM):", signature.toString('hex'));

  pkcs11.C_Logout(session);
  pkcs11.C_CloseSession(session);
} finally {
  pkcs11.C_Finalize();
}
```

---

## 4. Security Guarantees

- **Key Isolation**: The private key is generated on-chip and marked as "sensitive" and "non-extractable".
- **Hardware-Backed**: Signing happens inside the YubiKey's secure element.
- **Tamper Resistance**: Physical access and the User PIN are required to perform signing operations.

---

## 5. Manufacturer Integration Checklist

1. [ ] Choose a PKCS#11 compliant secure element (YubiKey, OPTIGA™ Trust M, etc.)
2. [ ] Implement the SolarProof canonical hashing algorithm in firmware.
3. [ ] Use the `CKM_EDDSA` mechanism for signing.
4. [ ] Ensure the public key registered in SolarProof matches the hardware-backed key.
