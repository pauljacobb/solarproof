import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase'

const VALID_EVENTS = [
  'anchor',
  'mint',
  'retire',
  'mint_failed',
  'certificate.minted',
  'certificate.transferred',
  'certificate.retired',
] as const

const WebhookSchema = z.object({
  cooperative_id: z.string().uuid(),
  url: z.string().url(),
  secret: z.string().min(16),
  events: z.array(z.enum(VALID_EVENTS)).min(1),
})

/**
 * POST /api/webhooks
 *
 * Register a webhook endpoint for a cooperative.
 * Body: { cooperative_id, url, secret, events }
 * Supported events: certificate.minted, certificate.transferred, certificate.retired
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = WebhookSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('webhook_endpoints')
    .insert(parsed.data)
    .select('id, cooperative_id, url, events, active, created_at')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to register webhook' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

/**
 * GET /api/webhooks?cooperative_id=UUID
 *
 * List registered webhook endpoints for a cooperative.
 */
export async function GET(req: NextRequest) {
  const cooperativeId = req.nextUrl.searchParams.get('cooperative_id')
  if (!cooperativeId) {
    return NextResponse.json({ error: 'cooperative_id is required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('webhook_endpoints')
    .select('id, cooperative_id, url, events, active, created_at')
    .eq('cooperative_id', cooperativeId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [] })
}
