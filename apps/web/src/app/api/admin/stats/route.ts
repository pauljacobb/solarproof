import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/stats
 * Returns platform-level stats: total kWh anchored, total certificates, active meters.
 */
export async function GET(req: NextRequest) {
  const err = requireAdmin(req)
  if (err) return err

  const db = createServiceClient()

  const [kwhResult, certResult, meterResult] = await Promise.all([
    db.from('readings').select('kwh').eq('anchored', true),
    db.from('certificates').select('id', { count: 'exact', head: true }),
    db.from('meters').select('id', { count: 'exact', head: true }).eq('active', true),
  ])

  const total_kwh = (kwhResult.data ?? []).reduce((sum, r) => sum + Number(r.kwh), 0)

  return NextResponse.json({
    total_kwh: Math.round(total_kwh * 1000) / 1000,
    total_certificates: certResult.count ?? 0,
    active_meters: meterResult.count ?? 0,
  })
}
