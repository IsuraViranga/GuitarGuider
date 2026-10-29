import { expect, type Page } from '@playwright/test'

/**
 * Signed-in students do the guitar setup before their first song. Tests that practise as a
 * student save one for the account directly (the setup itself needs a guitar and a microphone).
 */
export async function saveGuitarSetup(page: Page) {
  const response = await page.request.put('/api/string-setup', {
    headers: { 'X-Requested-With': 'fetch' },
    data: { open: { 1: 1.7e-5, 2: 4.2e-5, 3: 3.7e-5, 4: 6.4e-5, 5: 11.5e-5, 6: 17.6e-5 }, misfit: { 1: 0.34, 2: 0.31, 3: 2.46, 4: 0.61, 5: 1.14, 6: 1.55 } },
  })
  expect(response.ok()).toBe(true)
}
