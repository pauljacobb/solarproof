/**
 * tracer-sim integration tests.
 *
 * Covers:
 * - Failed mint triggers tracer-sim diagnosis
 * - Diagnosis result stored and retrievable
 * - tracer-sim unavailable handled gracefully
 * - Mock tracer-sim used in unit tests
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { diagnoseMintFailure, type TracerDiagnosis } from '@/lib/tracer-sim'

// ---------------------------------------------------------------------------
// Mock Supabase service client
// ---------------------------------------------------------------------------
const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}))

// ---------------------------------------------------------------------------
// Mock webhooks — fire-and-forget, not under test here
// ---------------------------------------------------------------------------
vi.mock('@/lib/webhooks', () => ({
  fireWebhook: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    withCorrelationId: vi.fn().mockReturnThis(),
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockTracerSim(response: Partial<TracerDiagnosis> | null, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response ?? {},
  })
}

function clearTracerSim() {
  vi.restoreAllMocks()
  delete process.env.TRACER_SIM_URL
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('diagnoseMintFailure', () => {
  const READING_ID = 'reading-abc-123'
  const COOP_ID = 'coop-xyz-456'
  const MINT_ERROR = 'Transaction simulation failed: insufficient balance'

  beforeEach(() => {
    mockFrom.mockClear()
    mockUpdate.mockClear()
  })

  afterEach(() => {
    clearTracerSim()
  })

  it('returns stub diagnosis when TRACER_SIM_URL is not set', async () => {
    delete process.env.TRACER_SIM_URL

    const diagnosis = await diagnoseMintFailure(READING_ID, COOP_ID, MINT_ERROR)

    expect(diagnosis.error_code).toBe('TRACER_SIM_UNAVAILABLE')
    expect(diagnosis.message).toBe(MINT_ERROR)
    expect(diagnosis.suggestion).toContain('TRACER_SIM_URL')
    expect(diagnosis.replayed_at).toBeTruthy()
  })

  it('stores diagnosis on the reading record', async () => {
    delete process.env.TRACER_SIM_URL

    await diagnoseMintFailure(READING_ID, COOP_ID, MINT_ERROR)

    expect(mockFrom).toHaveBeenCalledWith('readings')
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ mint_diagnosis: expect.any(Object) })
    )
  })

  it('calls tracer-sim /replay when TRACER_SIM_URL is set', async () => {
    process.env.TRACER_SIM_URL = 'http://tracer-sim.local'
    mockTracerSim({
      error_code: 'INSUFFICIENT_BALANCE',
      message: MINT_ERROR,
      suggestion: 'Fund the minter account.',
    })

    const diagnosis = await diagnoseMintFailure(READING_ID, COOP_ID, MINT_ERROR)

    expect(global.fetch).toHaveBeenCalledWith(
      'http://tracer-sim.local/replay',
      expect.objectContaining({ method: 'POST' })
    )
    expect(diagnosis.error_code).toBe('INSUFFICIENT_BALANCE')
    expect(diagnosis.suggestion).toBe('Fund the minter account.')
  })

  it('diagnosis result is stored and retrievable from the reading record', async () => {
    process.env.TRACER_SIM_URL = 'http://tracer-sim.local'
    const tracerResponse: Partial<TracerDiagnosis> = {
      error_code: 'CONTRACT_REVERT',
      message: 'Contract reverted',
      suggestion: 'Check contract state.',
    }
    mockTracerSim(tracerResponse)

    const diagnosis = await diagnoseMintFailure(READING_ID, COOP_ID, MINT_ERROR)

    // Verify the stored value matches what was returned
    const storedArg = mockUpdate.mock.calls[0][0]
    expect(storedArg.mint_diagnosis).toMatchObject({
      error_code: 'CONTRACT_REVERT',
      message: 'Contract reverted',
    })
    expect(diagnosis).toMatchObject(storedArg.mint_diagnosis)
  })

  it('handles tracer-sim HTTP error gracefully', async () => {
    process.env.TRACER_SIM_URL = 'http://tracer-sim.local'
    mockTracerSim(null, 503)

    const diagnosis = await diagnoseMintFailure(READING_ID, COOP_ID, MINT_ERROR)

    expect(diagnosis.error_code).toBe('REPLAY_ERROR')
    expect(diagnosis.message).toBe(MINT_ERROR)
  })

  it('handles tracer-sim network failure gracefully', async () => {
    process.env.TRACER_SIM_URL = 'http://tracer-sim.local'
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const diagnosis = await diagnoseMintFailure(READING_ID, COOP_ID, MINT_ERROR)

    expect(diagnosis.error_code).toBe('REPLAY_ERROR')
    expect(diagnosis.suggestion).toContain('tracer-sim replay failed')
  })

  it('handles tracer-sim timeout gracefully', async () => {
    process.env.TRACER_SIM_URL = 'http://tracer-sim.local'
    global.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'))

    const diagnosis = await diagnoseMintFailure(READING_ID, COOP_ID, MINT_ERROR)

    expect(diagnosis.error_code).toBe('REPLAY_ERROR')
  })

  it('fills in missing fields from partial tracer-sim response', async () => {
    process.env.TRACER_SIM_URL = 'http://tracer-sim.local'
    // Partial response — missing suggestion
    mockTracerSim({ error_code: 'PARTIAL' })

    const diagnosis = await diagnoseMintFailure(READING_ID, COOP_ID, MINT_ERROR)

    expect(diagnosis.error_code).toBe('PARTIAL')
    expect(diagnosis.message).toBe(MINT_ERROR)
    expect(diagnosis.suggestion).toBe('Check Stellar network status.')
  })
})
