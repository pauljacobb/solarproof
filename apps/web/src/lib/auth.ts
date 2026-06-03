import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import type { Database } from './database.types'
import { env } from '@/env'

/**
 * Create a Supabase client that validates the caller's JWT (anon key, RLS enforced).
 */
export function createUserClient(accessToken: string) {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    }
  )
}

/** Service-role client — bypasses RLS, used for revocation list writes. */
function createServiceClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
}

/**
 * Decode the JTI claim from a JWT without verifying the signature.
 * Verification is handled by Supabase's getUser() call.
 */
function extractJti(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return typeof payload.jti === 'string' ? payload.jti : null
  } catch {
    return null
  }
}

/**
 * Check whether a token's JTI appears in the revocation list.
 * Returns true if the token has been revoked.
 */
async function isRevoked(jti: string): Promise<boolean> {
  const db = createServiceClient()
  const { data } = await db
    .from('revoked_tokens')
    .select('jti')
    .eq('jti', jti)
    .maybeSingle()
  return data !== null
}

/**
 * Add a token's JTI to the revocation list.
 * expires_at is set to now + 15 minutes (access token max lifetime).
 */
export async function revokeToken(accessToken: string): Promise<void> {
  const jti = extractJti(accessToken)
  if (!jti) return
  const db = createServiceClient()
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  await db.from('revoked_tokens').upsert({ jti, expires_at: expiresAt })
}

/**
 * Extract and validate the Bearer JWT from the `Authorization` header.
 * Also checks the revocation list before accepting the token.
 */
export async function requireAuth(
  req: NextRequest
): Promise<{ user: { id: string; email?: string }; accessToken: string } | NextResponse> {
  const authHeader = req.headers.get('authorization') ?? ''
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!accessToken) {
    return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 })
  }

  // Check revocation list before hitting Supabase
  const jti = extractJti(accessToken)
  if (jti && (await isRevoked(jti))) {
    return NextResponse.json({ error: 'Token has been revoked' }, { status: 401 })
  }

  const client = createUserClient(accessToken)
  const { data, error } = await client.auth.getUser()

  if (error || !data.user) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }

  return { user: { id: data.user.id, email: data.user.email }, accessToken }
}

/**
 * Type guard: returns `true` when `requireAuth` returned a `NextResponse`.
 */
export function isAuthError(result: unknown): result is NextResponse {
  return result instanceof NextResponse
}
