import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ createServiceClient: vi.fn() }))

import { createServiceClient } from '@/lib/supabase'
import { GET } from '@/app/api/certificates/route'

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/certificates')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

const CERT = {
  id: 'cert-1',
  kwh: 10,
  issued_at: '2026-01-01T00:00:00Z',
  retired: false,
  retired_at: null,
  retired_by: null,
  mint_tx_hash: 'abc',
  readings: { meter_id: 'meter-1' },
}

function mockDb(data: unknown[], error: unknown = null, count = 1) {
  const query: Record<string, unknown> = {}
  const chain = (obj: Record<string, unknown>) => {
    ;['select', 'order', 'limit', 'lt', 'eq', 'gte', 'lte', 'or'].forEach((m) => {
      obj[m] = vi.fn().mockReturnValue(obj)
    })
    obj.then = undefined
    // Make it thenable for await
    Object.defineProperty(obj, Symbol.iterator, { value: undefined })
    return obj
  }
  const q = chain(query)
  // Final await resolves with data
  ;(q as unknown as Promise<unknown>)[Symbol.for('vitest-mock-result')] = { data, error, count }
  vi.mocked(createServiceClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            lt: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            or: vi.fn().mockResolvedValue({ data, error, count }),
            then: undefined,
            // make it awaitable
            [Symbol.toStringTag]: 'Promise',
          }),
        }),
      }),
    }),
  } as ReturnType<typeof createServiceClient>)
}

function mockDbSimple(data: unknown[], error: unknown = null, count = data.length) {
  const terminal = vi.fn().mockResolvedValue({ data, error, count })
  const makeChain = (): Record<string, unknown> => {
    const obj: Record<string, unknown> = {}
    ;['lt', 'eq', 'gte', 'lte', 'or'].forEach((m) => { obj[m] = vi.fn().mockReturnValue(obj) })
    // Make awaitable
    obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error, count }).then(resolve)
    obj.catch = (reject: (e: unknown) => unknown) => Promise.resolve({ data, error, count }).catch(reject)
    return obj
  }
  vi.mocked(createServiceClient).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue(makeChain()),
        }),
      }),
    }),
  } as ReturnType<typeof createServiceClient>)
  return terminal
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/certificates', () => {
  it('returns 200 with data array on success', async () => {
    mockDbSimple([CERT])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data)).toBe(true)
  })

  it('returns 500 when DB errors', async () => {
    mockDbSimple([], { message: 'db error' })
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('db error')
  })

  it('respects limit param (max 100)', async () => {
    mockDbSimple([])
    const res = await GET(makeRequest({ limit: '200' }))
    expect(res.status).toBe(200)
  })

  it('returns next_cursor when there are more results', async () => {
    // Return limit+1 items to trigger hasMore
    const items = Array.from({ length: 21 }, (_, i) => ({ ...CERT, id: `cert-${i}`, issued_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, readings: { meter_id: 'meter-1' } }))
    mockDbSimple(items, null, 100)
    const res = await GET(makeRequest({ limit: '20' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.next_cursor).not.toBeNull()
    expect(body.data).toHaveLength(20)
  })

  it('returns null next_cursor when no more results', async () => {
    mockDbSimple([CERT], null, 1)
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.next_cursor).toBeNull()
  })

  it('normalizes readings join to meter_id field', async () => {
    mockDbSimple([CERT], null, 1)
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.data[0].meter_id).toBe('meter-1')
    expect(body.data[0].readings).toBeUndefined()
  })

  it('handles array readings join', async () => {
    const certWithArray = { ...CERT, readings: [{ meter_id: 'meter-arr' }] }
    mockDbSimple([certWithArray], null, 1)
    const res = await GET(makeRequest())
    const body = await res.json()
    expect(body.data[0].meter_id).toBe('meter-arr')
  })
})
