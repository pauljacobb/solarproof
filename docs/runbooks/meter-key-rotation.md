# Runbook: Meter Key Rotation

Covers rotating the Ed25519 signing key for a meter device — scheduled rotation, suspected compromise, or key loss.

---

## When to Rotate

- Scheduled rotation (recommended: annually or per security policy)
- Private key suspected compromised or exposed
- Device transferred to a new operator
- Key material lost

---

## Steps

### 1. Generate a new keypair

```bash
node scripts/gen-meter-key.mjs
# Writes meter-key-new.json: { private_key_hex, public_key_hex }
```

For production devices, generate the keypair on the device itself (HSM/TPM). Never generate a production key on a workstation.

### 2. Register the new public key

Insert the new key into the `meters` table with a new UUID, keeping the old record active during the transition:

```sql
INSERT INTO meters (id, pubkey_hex, cooperative_id, active)
VALUES (gen_random_uuid(), '<new-64-char-hex-pubkey>', '<cooperative-uuid>', true);
```

Note the new `meter_id` — the device must use this UUID in all future reading submissions.

### 3. Update the device

Deploy the new private key and new `meter_id` to the device. For HSM-backed devices, provision the new key into the secure enclave and update the device configuration.

### 4. Verify the new key works

Send a test reading using the new key and confirm a `201 Created` response:

```bash
node scripts/send-reading.mjs \
  --meter-id <new-meter-uuid> \
  --kwh 0.001 \
  --key ./meter-key-new.json \
  --api https://<your-api-host>
```

### 5. Deactivate the old meter record

Once the new key is confirmed working, deactivate the old record:

```sql
UPDATE meters SET active = false WHERE id = '<old-meter-uuid>';
```

The old record is retained for audit purposes — do not delete it.

### 6. Securely destroy the old private key

- Remove the old key from the device's secure storage
- Delete any copies from workstations, CI secrets, or backups
- Record the rotation in the audit log

---

## Notes

- The server rejects readings from inactive meter records (`404` response)
- Readings signed with the old key after deactivation will be rejected
- If the key was compromised, deactivate the old record immediately (step 5) before completing the rest of the rotation
- Test rotation in staging before applying to production meters
