import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  console.warn('[CSP Violation]', JSON.stringify(body))
  return NextResponse.json({}, { status: 204 })
}
