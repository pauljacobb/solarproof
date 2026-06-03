import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

/**
 * GET /api/webhooks/logs?endpoint_id=UUID&limit=50
 *
 * Returns webhook delivery log entries for a given endpoint.
 * Ordered by most recent first.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const endpointId = searchParams.get('endpoint_id')
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200)

  if (!endpointId) {
    return NextResponse.json({ error: 'endpoint_id is required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('webhook_logs')
    .select('id, endpoint_id, event, status, attempts, response_status, created_at')
    .eq('endpoint_id', endpointId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: data ?? [] })
}
