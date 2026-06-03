/**
 * Mock Freighter wallet for CI/test environments.
 *
 * Installs a `window.freighter` stub that simulates connection, signing,
 * and disconnection without requiring the browser extension.
 *
 * Usage:
 *   import { installMockFreighter, uninstallMockFreighter } from '@/tests/mock-freighter'
 *
 *   beforeEach(() => installMockFreighter())
 *   afterEach(() => uninstallMockFreighter())
 */

export interface MockFreighterOptions {
  publicKey?: string
  /** If true, isAllowed() returns false until requestAccess() is called */
  requiresAccess?: boolean
}

const DEFAULT_PUBLIC_KEY = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'

export interface MockFreighter {
  isAllowed: () => Promise<boolean>
  requestAccess: () => Promise<void>
  getPublicKey: () => Promise<string>
  signTransaction: (xdr: string) => Promise<string>
  _reset: () => void
  _setPublicKey: (key: string) => void
}

export function createMockFreighter(opts: MockFreighterOptions = {}): MockFreighter {
  let publicKey = opts.publicKey ?? DEFAULT_PUBLIC_KEY
  let allowed = !(opts.requiresAccess ?? false)

  return {
    isAllowed: async () => allowed,
    requestAccess: async () => { allowed = true },
    getPublicKey: async () => {
      if (!allowed) throw new Error('Not allowed — call requestAccess first')
      return publicKey
    },
    signTransaction: async (xdr: string) => {
      if (!allowed) throw new Error('Not allowed — call requestAccess first')
      // Return a deterministic mock-signed XDR (prefixed for test identification)
      return `mock-signed:${xdr}`
    },
    _reset: () => {
      allowed = !(opts.requiresAccess ?? false)
      publicKey = opts.publicKey ?? DEFAULT_PUBLIC_KEY
    },
    _setPublicKey: (key: string) => { publicKey = key },
  }
}

let _installed: MockFreighter | null = null

/**
 * Install the mock Freighter wallet on `window.freighter`.
 * Safe to call in jsdom or happy-dom test environments.
 */
export function installMockFreighter(opts: MockFreighterOptions = {}): MockFreighter {
  const mock = createMockFreighter(opts)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window = (globalThis as any).window ?? {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window.freighter = mock
  _installed = mock
  return mock
}

/**
 * Remove the mock Freighter wallet from `window.freighter`.
 */
export function uninstallMockFreighter(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((globalThis as any).window?.freighter) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window.freighter
  }
  _installed = null
}

/** Return the currently installed mock, or null if not installed. */
export function getMockFreighter(): MockFreighter | null {
  return _installed
}
