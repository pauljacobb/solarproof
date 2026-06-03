import { test, expect } from '@playwright/test'

/**
 * E2E: connect wallet → view dashboard
 *
 * The dashboard is gated by WalletGate — it renders a "Connect Wallet" prompt
 * until a Freighter wallet is connected. In CI there is no real wallet extension,
 * so we mock the Freighter API on the window object before the page loads.
 */
test.describe('Dashboard — wallet gate', () => {
  test.beforeEach(async ({ page }) => {
    // Inject a minimal Freighter mock so WalletGate considers the wallet connected
    await page.addInitScript(() => {
      const mockPublicKey = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN'
      ;(window as unknown as Record<string, unknown>).freighter = {
        isConnected: () => Promise.resolve(true),
        getPublicKey: () => Promise.resolve(mockPublicKey),
        getNetwork: () => Promise.resolve('TESTNET'),
        signTransaction: () => Promise.reject(new Error('not needed')),
      }
    })
  })

  test('shows dashboard content after wallet is connected', async ({ page }) => {
    await page.goto('/dashboard')
    // WalletGate should pass through — dashboard heading must be visible
    await expect(page.locator('h1, h2').filter({ hasText: /dashboard/i }).first()).toBeVisible({
      timeout: 15000,
    })
  })

  test('shows connect-wallet prompt when wallet is not connected', async ({ page }) => {
    // No mock injected — WalletGate should render the connect prompt
    await page.goto('/dashboard')
    await expect(
      page.locator('button, [role="button"]').filter({ hasText: /connect/i }).first()
    ).toBeVisible({ timeout: 10000 })
  })
})
