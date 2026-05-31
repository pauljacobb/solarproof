import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ createServiceClient: vi.fn() }))

import { createServiceClient } from '@/lib/supabase'
import { GET } from '@/app/api/ready/route'

function mockDb(error: unknown = null) {
  vi.mocked(createServiceClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({ data: [{ id: '1' }], error }),
      }),
    }),
  } as ReturnType<typeof createServiceClient>)
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/ready', () => {
  it('returns 200 when DB is healthy', async () => {
    mockDb()
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.checks.db).toBe(true)
  })

  it('returns 503 when DB check fails', async () => {
    mockDb({ message: 'connection refused' })
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe('degraded')
    expect(body.checks.db).toBe(false)
  })
})
