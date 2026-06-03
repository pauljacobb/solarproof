import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase'
import { retireCertificate } from '@/lib/stellar'
import { fireWebhook } from '@/lib/webhooks'

const MAX_BULK = 100

const BulkRetireSchema = z.object({
  certificate_ids: z.array(z.string().uuid()).min(1).max(MAX_BULK),
  wallet_address: z.string().min(1),
})

/**
 * POST /api/certificates/retire/bulk
 *
 * Retire up to 100 certificates in a single request.
 * Returns per-certificate success/failure status.
 * Partial failures are reported — the operation is best-effort, not atomic.
 *
 * Body: { certificate_ids: string[], wallet_address: string }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = BulkRetireSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { certificate_ids, wallet_address } = parsed.data
  const db = createServiceClient()

  const { data: certs, error: fetchErr } = await db
    .from('certificates')
    .select('*')
    .in('id', certificate_ids)

  if (fetchErr) {
    return NextResponse.json({ error: 'Failed to fetch certificates' }, { status: 500 })
  }

  const certMap = new Map((certs ?? []).map((c) => [c.id, c]))

  const results = await Promise.all(
    certificate_ids.map(async (id) => {
      const cert = certMap.get(id)
      if (!cert) return { id, success: false, error: 'Certificate not found' }
      if (cert.retired) return { id, success: false, error: 'Already retired' }

      try {
        const retireTxHash = await retireCertificate(wallet_address, cert.kwh)

        const { data: updated, error: updateErr } = await db
          .from('certificates')
          .update({
            retired: true,
            retired_at: new Date().toISOString(),
            retired_by: wallet_address,
          })
          .eq('id', id)
          .select()
          .single()

        if (updateErr || !updated) {
          return { id, success: false, error: 'Failed to update certificate' }
        }

        void fireWebhook(updated.cooperative_id, 'retire', {
          certificate_id: updated.id,
          retired_by: updated.retired_by,
          retire_tx_hash: retireTxHash,
        })

        return { id, success: true, retire_tx_hash: retireTxHash }
      } catch (err) {
        return { id, success: false, error: err instanceof Error ? err.message : 'Retire failed' }
      }
    })
  )

  const succeeded = results.filter((r) => r.success).length
  const failed = results.length - succeeded

  return NextResponse.json(
    { results, summary: { total: results.length, succeeded, failed } },
    { status: failed === results.length ? 500 : 200 }
  )
}
