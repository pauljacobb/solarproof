import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-auth'

const PatchSchema = z.object({ suspended: z.boolean() })

/**
 * PATCH /api/admin/operators/[id]
 * Suspend or unsuspend an operator (cooperative).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const err = requireAdmin(req)
  if (err) return err

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('cooperatives')
    .update({ suspended: parsed.data.suspended })
    .eq('id', id)
    .select('id, name, suspended')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
