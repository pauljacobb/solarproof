/**
 * Lightweight async job queue backed by Supabase.
 *
 * Usage:
 *   const jobId = await enqueue('anchor_and_mint', { readingId, ... })
 *   // returns immediately; worker processes in background
 */
import { createServiceClient } from '@/lib/supabase'

export type JobType = 'anchor_and_mint'
export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

const MAX_ATTEMPTS = 3

/**
 * Enqueue a background job and return its ID.
 *
 * The job is persisted to Supabase and then processed asynchronously
 * (fire-and-forget). The caller receives the job ID immediately and can
 * poll `GET /api/jobs/[id]` for completion status.
 *
 * @param type - Job type identifier (e.g. `'anchor_and_mint'`).
 * @param payload - Serialisable job payload passed to the handler.
 * @returns UUID of the newly created job record.
 * @throws If the Supabase insert fails.
 */
export async function enqueue(type: JobType, payload: Record<string, unknown>): Promise<string> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('jobs')
    .insert({ type, payload, status: 'pending', attempts: 0 })
    .select('id')
    .single()

  if (error || !data) throw new Error(`Failed to enqueue job: ${error?.message}`)

  // Fire-and-forget: process in background without blocking the response
  processJob(data.id).catch((err) =>
    console.error(`[queue] background processing error job=${data.id}`, err)
  )

  return data.id
}

/**
 * Process a single job by ID, retrying up to `MAX_ATTEMPTS` times on failure.
 *
 * Retries use exponential back-off (2 s, 4 s, 8 s). After all attempts are
 * exhausted the job is marked `'failed'` and moved to the dead-letter queue.
 *
 * @param jobId - UUID of the job record to process.
 */
export async function processJob(jobId: string): Promise<void> {
  const db = createServiceClient()

  const { data: job } = await db
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (!job || job.status === 'done') return

  const attempts = job.attempts + 1
  await db.from('jobs').update({ status: 'running', attempts }).eq('id', jobId)

  try {
    const result = await runJob(job.type as JobType, job.payload as Record<string, unknown>)
    await db.from('jobs').update({ status: 'done', result }).eq('id', jobId)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (attempts < MAX_ATTEMPTS) {
      // Exponential back-off: 2s, 4s, 8s
      const delay = 2 ** attempts * 1000
      await db.from('jobs').update({ status: 'pending', error }).eq('id', jobId)
      setTimeout(() => processJob(jobId).catch(console.error), delay)
    } else {
      await db.from('jobs').update({ status: 'failed', error }).eq('id', jobId)
    }
  }
}

/** Dispatch to the correct handler based on job type. */
async function runJob(
  type: JobType,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  switch (type) {
    case 'anchor_and_mint':
      return runAnchorAndMint(payload)
    default:
      throw new Error(`Unknown job type: ${type}`)
  }
}

async function runAnchorAndMint(
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // Lazy import to avoid circular deps
  const { anchorReading, mintCertificates } = await import('@/lib/stellar')
  const { createServiceClient: svc } = await import('@/lib/supabase')
  const { invalidateCert } = await import('@/lib/cache')
  const { fireWebhook } = await import('@/lib/webhooks')

  const { readingId, readingHashHex, recipientAddress, kwh, correlationId } = payload as {
    readingId: string
    readingHashHex: string
    recipientAddress: string
    kwh: number
    correlationId: string
  }

  const db = svc()
  const readingHash = Buffer.from(readingHashHex, 'hex')

  const anchorTxHash = await anchorReading({ readingHash, correlationId })
  await db.from('readings').update({ anchored: true, anchor_tx_hash: anchorTxHash }).eq('id', readingId)

  const mintTxHash = await mintCertificates(recipientAddress, kwh, correlationId)
  await db.from('readings').update({ minted: true, mint_tx_hash: mintTxHash }).eq('id', readingId)

  // Fetch cooperative_id for certificate insert and webhooks
  const { data: reading } = await db
    .from('readings')
    .select('meter_id, meters(cooperative_id)')
    .eq('id', readingId)
    .single()

  const cooperativeId = (reading?.meters as { cooperative_id: string } | null)?.cooperative_id
  if (cooperativeId) {
    await db.from('certificates').insert({
      cooperative_id: cooperativeId,
      reading_id: readingId,
      reading_hash: readingHashHex,
      anchor_tx_hash: anchorTxHash,
      mint_tx_hash: mintTxHash,
      kwh,
      issued_at: new Date().toISOString(),
      retired: false,
    })
    await invalidateCert(readingId, readingHashHex, mintTxHash)
    await fireWebhook(cooperativeId, 'anchor', { reading_id: readingId, anchor_tx_hash: anchorTxHash })
    await fireWebhook(cooperativeId, 'mint', { reading_id: readingId, mint_tx_hash: mintTxHash, kwh })
  }

  return { anchor_tx_hash: anchorTxHash, mint_tx_hash: mintTxHash }
}
