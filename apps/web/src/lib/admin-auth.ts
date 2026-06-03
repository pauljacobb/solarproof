import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/env'

/** Validate the admin bearer token. Returns 401 response on failure. */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const secret = env.ADMIN_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Admin interface not configured' }, { status: 503 })
  }
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
