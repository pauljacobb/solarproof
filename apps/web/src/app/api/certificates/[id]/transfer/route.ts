import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isValidStellarAddress } from '@stellar/stellar-sdk'
import { createServiceClient } from '@/lib/supabase'
import { transferCertificate } from '@/lib/stellar'
import { auditLog } from '@/lib/audit'
import { fireWebhook } from '@/lib/webhooks'

const TransferSchema = z.object({
  from_address: z.string().min(1),
  to_address: z.string().min(1),
})

const ParamsSchema = z.object({
  id: z.string().uuid(),
})

/**
 * POST /api/certificates/[id]/transfer
 *
 * Transfers a certificate to another Stellar account via SEP-41 transfer.
 * Body: { from_address, to_address }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const parsedParams = ParamsSchema.safeParse(await params)
  if (!parsedParams.success) {
    return NextResponse.json({ error: parsedParams.error.flatten() }, { status: 400 })
  }
  const { id } = parsedParams.data

  const body = await req.json().catch(() => null)
  const parsed = TransferSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { from_address, to_address } = parsed.data

  if (!isValidStellarAddress(to_address)) {
    return NextResponse.json({ error: 'Invalid recipient Stellar address' }, { status: 400 })
  }

  if (from_address === to_address) {
    return NextResponse.json({ error: 'Sender and recipient must differ' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data: cert } = await db
    .from('certificates')
    .select('*')
    .eq('id', id)
    .single()

  if (!cert) {
    return NextResponse.json({ error: 'Certificate not found' }, { status: 404 })
  }

  if (cert.retired) {
    return NextResponse.json({ error: 'Cannot transfer a retired certificate' }, { status: 409 })
  }

  let transferTxHash: string
  try {
    transferTxHash = await transferCertificate(from_address, to_address, cert.kwh)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transfer transaction failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  await auditLog(req, {
    operator_id: from_address,
    action: 'certificate.transfer',
    resource_id: id,
    metadata: { from_address, to_address, transfer_tx_hash: transferTxHash },
  })

  void fireWebhook(cert.cooperative_id, 'transfer', {
    certificate_id: id,
    from_address,
    to_address,
    transfer_tx_hash: transferTxHash,
  })

  return NextResponse.json({
    id,
    from_address,
    to_address,
    transfer_tx_hash: transferTxHash,
  })
}
