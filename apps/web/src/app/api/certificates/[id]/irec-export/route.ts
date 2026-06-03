import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase'
import { buildIRecXml } from '@/lib/irec-xml'

const ParamsSchema = z.object({ id: z.string().uuid() })

/**
 * GET /api/certificates/[id]/irec-export
 *
 * Returns the certificate as I-REC compliant XML with on-chain anchor proof.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const parsedParams = ParamsSchema.safeParse(await params)
  if (!parsedParams.success) {
    return NextResponse.json({ error: parsedParams.error.flatten() }, { status: 400 })
  }
  const { id } = parsedParams.data

  const db = createServiceClient()
  const { data: cert } = await db
    .from('certificates')
    .select('id, kwh, issued_at, retired, retired_at, retired_by, mint_tx_hash, cooperative_id, readings!inner(meter_id)')
    .eq('id', id)
    .single()

  if (!cert) {
    return NextResponse.json({ error: 'Certificate not found' }, { status: 404 })
  }

  // Resolve wallet address from query param (holder must supply their address)
  const holderAddress = req.nextUrl.searchParams.get('holder') ?? ''

  const readings = cert.readings as { meter_id: string } | { meter_id: string }[]
  const meter_id = Array.isArray(readings) ? readings[0]?.meter_id : readings?.meter_id ?? null

  const xml = buildIRecXml({
    id: cert.id,
    kwh: cert.kwh,
    issued_at: cert.issued_at,
    holder_address: holderAddress,
    mint_tx_hash: cert.mint_tx_hash,
    meter_id,
    retired: cert.retired,
    retired_at: cert.retired_at,
    retired_by: cert.retired_by,
    cooperative_id: cert.cooperative_id,
  })

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="irec-${id}.xml"`,
    },
  })
}
