import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export type AuditAction =
  | 'reading.create'
  | 'certificate.retire'
  | 'certificate.transfer'
  | 'meter.register'
  | 'meter.deactivate'

interface AuditEntry {
  operator_id: string
  action: AuditAction
  resource_id?: string
  metadata?: Record<string, unknown>
}

function getClientIp(req: NextRequest): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    null
  )
}

/**
 * Append an entry to the `audit_log` table.
 *
 * Captures the client IP from `x-forwarded-for` or `x-real-ip` headers.
 * Failures are logged to stderr but never thrown — audit logging must not
 * block or fail the primary request path.
 *
 * @param req - Incoming Next.js request (used to extract the client IP).
 * @param entry - Audit entry containing operator, action, and optional metadata.
 */
export async function auditLog(req: NextRequest, entry: AuditEntry): Promise<void> {
  try {
    const db = createServiceClient()
    const { error } = await db.from('audit_log').insert({
      operator_id: entry.operator_id,
      action: entry.action,
      resource_id: entry.resource_id ?? null,
      ip_address: getClientIp(req),
      metadata: entry.metadata ?? null,
    })
    if (error) console.error('[audit] insert failed:', error.message)
  } catch (err) {
    console.error('[audit] unexpected error:', err)
  }
}
