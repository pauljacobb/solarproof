import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthError, createUserClient, revokeToken } from '@/lib/auth'

/** POST /api/auth/logout — invalidate the current session and revoke the token */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthError(auth)) return auth

  // Add token to revocation list before signing out
  await revokeToken(auth.accessToken)

  const client = createUserClient(auth.accessToken)
  const { error } = await client.auth.signOut()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
