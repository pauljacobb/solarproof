import { Keypair, TransactionBuilder, Networks, BASE_FEE, Contract, Address, xdr } from '@stellar/stellar-sdk'
import * as SorobanRpc from '@stellar/stellar-sdk/rpc'
import { kwhToStroops, amountToScVal, addressToScVal, bytesToScVal } from '@solarproof/stellar'
import { env } from '@/env'
import { createHash } from 'crypto'

const NETWORK_PASSPHRASE = Networks.TESTNET
const RPC_URL = 'https://soroban-testnet.stellar.org'
const RPC_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------
// Circuit breaker — opens after 5 consecutive timeouts, resets after 60 s
// ---------------------------------------------------------------------------
const CB = {
  failures: 0,
  openUntil: 0,
  THRESHOLD: 5,
  RESET_MS: 60_000,
}

export class StellarTimeoutError extends Error {
  readonly correlationId: string
  constructor(correlationId: string) {
    super(`Stellar RPC timeout [${correlationId}]`)
    this.name = 'StellarTimeoutError'
    this.correlationId = correlationId
  }
}

export class CircuitOpenError extends Error {
  readonly retryAfter: number
  constructor(retryAfter: number) {
    super('Stellar RPC circuit open — too many recent timeouts')
    this.name = 'CircuitOpenError'
    this.retryAfter = retryAfter
  }
}

function checkCircuit() {
  if (CB.openUntil && Date.now() < CB.openUntil) {
    throw new CircuitOpenError(Math.ceil((CB.openUntil - Date.now()) / 1000))
  }
  if (CB.openUntil && Date.now() >= CB.openUntil) {
    CB.failures = 0
    CB.openUntil = 0
  }
}

function recordSuccess() {
  CB.failures = 0
  CB.openUntil = 0
}

function recordFailure(correlationId: string) {
  CB.failures++
  console.error(`[stellar] timeout correlationId=${correlationId} failures=${CB.failures}`)
  if (CB.failures >= CB.THRESHOLD) {
    CB.openUntil = Date.now() + CB.RESET_MS
    console.error(`[stellar] circuit opened until ${new Date(CB.openUntil).toISOString()}`)
  }
}

/**
 * Wrap a promise with a timeout.
 *
 * @param promise - The promise to race against the timeout.
 * @param correlationId - Identifier used in the thrown error for tracing.
 * @returns Resolves with the promise value if it settles before the timeout.
 * @throws {StellarTimeoutError} If the promise does not settle within `RPC_TIMEOUT_MS`.
 */
async function withTimeout<T>(promise: Promise<T>, correlationId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StellarTimeoutError(correlationId)), RPC_TIMEOUT_MS)
  })
  try {
    const result = await Promise.race([promise, timeout])
    clearTimeout(timer!)
    return result
  } catch (err) {
    clearTimeout(timer!)
    throw err
  }
}

/**
 * Execute an RPC call with timeout and circuit-breaker protection.
 *
 * @param fn - Factory that returns the RPC promise to execute.
 * @param correlationId - Identifier propagated to timeout errors and logs.
 * @returns The resolved value of `fn()`.
 * @throws {CircuitOpenError} When the circuit breaker is open.
 * @throws {StellarTimeoutError} When the call exceeds `RPC_TIMEOUT_MS`.
 */
async function rpcCall<T>(fn: () => Promise<T>, correlationId: string): Promise<T> {
  checkCircuit()
  try {
    const result = await withTimeout(fn(), correlationId)
    recordSuccess()
    return result
  } catch (err) {
    if (err instanceof StellarTimeoutError) {
      recordFailure(correlationId)
    }
    throw err
  }
}

/** Delays that grow as 1 s, 2 s, 4 s for attempts 1, 2, 3. */
const BACKOFF_MS = [1_000, 2_000, 4_000]
const MAX_RETRIES = 3

/** Return a Soroban RPC server pointed at the configured testnet endpoint. */
function getServer() {
  return new SorobanRpc.Server(env.NEXT_PUBLIC_STELLAR_RPC_URL)
}

async function submitTx(
  tx: ReturnType<typeof TransactionBuilder.prototype.build>,
  signer: Keypair,
  correlationId: string
) {
  const server = getServer()
  const prepared = await rpcCall(() => server.prepareTransaction(tx), correlationId)
  prepared.sign(signer)
  const result = await rpcCall(() => server.sendTransaction(prepared), correlationId)
  if (result.status === 'ERROR') {
    throw new Error(`Transaction failed: ${JSON.stringify(result.errorResult)}`)
  }

  return result.hash
}

/**
 * Anchor a reading hash in the `audit_registry` Soroban contract.
 *
 * Derives a 32-byte nonce hash from `params.nonce` (SHA-256) and calls
 * `audit_registry.anchor(reading_hash, nonce_hash)`. The nonce prevents
 * duplicate anchors for the same reading hash.
 *
 * @param params.readingHash - 32-byte SHA-256 digest of the canonical reading.
 * @param params.nonce - Optional idempotency nonce; hashed before submission.
 * @param params.correlationId - Optional trace ID for logs and error messages.
 * @returns Stellar transaction hash of the anchor transaction.
 * @throws {CircuitOpenError} When the Stellar RPC circuit breaker is open.
 * @throws {StellarTimeoutError} When an RPC call exceeds the timeout.
 */
export async function anchorReading(params: {
  readingHash: Buffer
  nonce?: string
  correlationId?: string
}): Promise<string> {
  const correlationId = params.correlationId ?? crypto.randomUUID()
  const minter = Keypair.fromSecret(env.MINTER_SECRET_KEY)
  const server = getServer()
  const account = await rpcCall(() => server.getAccount(minter.publicKey()), correlationId)
  const contract = new Contract(env.NEXT_PUBLIC_AUDIT_REGISTRY_ID)

  // Derive a 32-byte hash from the nonce if provided, else use all zeros (for backwards compatibility in tests if any)
  const nonceBytes = params.nonce 
    ? createHash('sha256').update(params.nonce).digest() 
    : Buffer.alloc(32)

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call('anchor', bytesToScVal(params.readingHash), bytesToScVal(nonceBytes)))
    .setTimeout(30)
    .build()

  return submitTx(tx, minter, correlationId)
}

/**
 * Retire energy certificates on-chain by calling `energy_token.retire`.
 *
 * @param ownerAddress - Stellar G-address of the certificate holder.
 * @param kwh - Amount to retire in kilowatt-hours (converted to stroops internally).
 * @param correlationId - Optional trace ID for logs and error messages.
 * @returns Stellar transaction hash of the retire transaction.
 * @throws {CircuitOpenError} When the Stellar RPC circuit breaker is open.
 * @throws {StellarTimeoutError} When an RPC call exceeds the timeout.
 */
export async function retireCertificate(
  ownerAddress: string,
  kwh: number,
  correlationId = crypto.randomUUID()
): Promise<string> {
  const minter = Keypair.fromSecret(env.MINTER_SECRET_KEY)
  const server = getServer()
  const account = await rpcCall(() => server.getAccount(minter.publicKey()), correlationId)
  const contract = new Contract(env.NEXT_PUBLIC_ENERGY_TOKEN_ID)

    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(contract.call('retire', addressToScVal(ownerAddress), amountToScVal(kwhToStroops(kwh))))
      .setTimeout(30)
      .build()

  return submitTx(tx, minter, correlationId)
}

/**
 * Pre-flight check before minting: verifies the recipient account exists on
 * Stellar and has established a trustline for the energy_token contract.
 *
 * Throws a descriptive error with setup instructions if either check fails.
 */
export async function assertMintable(recipientAddress: string): Promise<void> {
  const server = getServer()

  // 1. Check account exists (Soroban RPC throws if not found)
  try {
    await server.getAccount(recipientAddress)
  } catch {
    throw new Error(
      `Recipient account ${recipientAddress} does not exist on Stellar. ` +
      `The account must be funded (minimum 1 XLM) before certificates can be minted. ` +
      `Fund it at https://laboratory.stellar.org/#account-creator?network=test`
    )
  }

  // 2. Check SAC trustline: a Balance entry must exist in the energy_token contract storage
  const recipientScAddress = Address.account(Keypair.fromPublicKey(recipientAddress).rawPublicKey())
  const balanceKey = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('Balance'),
      val: recipientScAddress.toScVal(),
    }),
  ])

  try {
    await server.getContractData(env.NEXT_PUBLIC_ENERGY_TOKEN_ID, balanceKey, SorobanRpc.Durability.Persistent)
  } catch {
    throw new Error(
      `Recipient account ${recipientAddress} has no trustline for the energy_token contract (${env.NEXT_PUBLIC_ENERGY_TOKEN_ID}). ` +
      `The account holder must call \`add_trustline\` on the contract to establish a trustline before certificates can be minted.`
    )
  }
}

/**
 * Transfer energy certificates from one account to another via SEP-41 transfer.
 *
 * @param fromAddress - Stellar G-address of the current certificate holder.
 * @param toAddress - Stellar G-address of the recipient.
 * @param kwh - Amount to transfer in kilowatt-hours.
 * @param correlationId - Optional trace ID for logs and error messages.
 * @returns Stellar transaction hash of the transfer transaction.
 */
export async function transferCertificate(
  fromAddress: string,
  toAddress: string,
  kwh: number,
  correlationId = crypto.randomUUID()
): Promise<string> {
  const minter = Keypair.fromSecret(env.MINTER_SECRET_KEY)
  const server = getServer()
  const account = await rpcCall(() => server.getAccount(minter.publicKey()), correlationId)
  const contract = new Contract(env.NEXT_PUBLIC_ENERGY_TOKEN_ID)

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call(
      'transfer',
      addressToScVal(fromAddress),
      addressToScVal(toAddress),
      amountToScVal(kwhToStroops(kwh))
    ))
    .setTimeout(30)
    .build()

  return submitTx(tx, minter, correlationId)
}

/**
 * Mint energy certificates after a successful anchor.
 *
 * Calls `energy_token.mint(recipient, amount_in_stroops)`. The recipient
 * must have an established trustline — call `assertMintable` first if unsure.
 *
 * @param recipientAddress - Stellar G-address that will receive the tokens.
 * @param kwh - Energy amount in kilowatt-hours (converted to stroops internally).
 * @param correlationId - Optional trace ID for logs and error messages.
 * @returns Stellar transaction hash of the mint transaction.
 * @throws {CircuitOpenError} When the Stellar RPC circuit breaker is open.
 * @throws {StellarTimeoutError} When an RPC call exceeds the timeout.
 */
export async function mintCertificates(
  recipientAddress: string,
  kwh: number,
  correlationId = crypto.randomUUID()
): Promise<string> {
  const minter = Keypair.fromSecret(env.MINTER_SECRET_KEY)
  const server = getServer()
  const account = await rpcCall(() => server.getAccount(minter.publicKey()), correlationId)
  const contract = new Contract(env.NEXT_PUBLIC_ENERGY_TOKEN_ID)

    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(contract.call('mint', addressToScVal(recipientAddress), amountToScVal(kwhToStroops(kwh))))
      .setTimeout(30)
      .build()

  return submitTx(tx, minter, correlationId)
}
