import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/operators
 * Returns all cooperatives with id, name, admin_address, suspended, created_at.
 */
export async function GET(req: NextRequest) {
  const err = requireAdmin(req)
  if (err) return err

  const db = createServiceClient()
  const { data, error } = await db
    .from('cooperatives')
    .select('id, name, admin_address, suspended, created_at')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
