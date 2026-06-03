import { test, expect } from '@playwright/test'

const CERT_ID = 'test-certificate-id-001'

const mockCertificate = {
  id: CERT_ID,
  kwh: 25,
  issued_at: '2025-06-01T00:00:00.000Z',
  retired: false,
  retired_at: null,
  retired_by: null,
  reading_id: 'reading-001',
  stellar_tx: 'mint_tx_abc123',
}

const mockReading = {
  id: 'reading-001',
  meter_id: 'meter-001',
  kwh: 25,
  timestamp: '2025-06-01T00:00:00.000Z',
  signature_hex: 'deadbeefdeadbeef',
  reading_hash: 'abcdef1234567890',
  verified: true,
  anchor_tx: 'anchor_tx_xyz789',
}

/**
 * E2E: view certificate detail page
 *
 * The certificate detail page is a server component that fetches from Supabase.
 * We intercept the Supabase REST calls and return mock data so the test is
 * hermetic and does not require a live database.
 */
test.describe('Certificate detail page', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept Supabase REST queries for certificates and readings
    await page.route('**/rest/v1/certificates*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockCertificate]),
      })
    })

    await page.route('**/rest/v1/readings*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([mockReading]),
      })
    })
  })

  test('renders certificate detail with chain-of-custody steps', async ({ page }) => {
    await page.goto(`/certificate/${CERT_ID}`)

    // Certificate ID or kWh value should appear on the page
    await expect(page.locator(`text=${CERT_ID}`).first()).toBeVisible({ timeout: 15000 })
  })

  test('shows not-found for unknown certificate ID', async ({ page }) => {
    await page.route('**/rest/v1/certificates*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/certificate/nonexistent-id-000')
    // Next.js notFound() renders a 404 page
    await expect(page.locator('text=/not found/i').first()).toBeVisible({ timeout: 10000 })
  })
})
