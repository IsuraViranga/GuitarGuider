import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Full stack: needs the API server on http://localhost:8000 with EMAIL_LOG_LINKS=true, its log
// written to the file named in API_LOG (the reset link is read from there). Skipped otherwise.

test.beforeAll(async ({ request }) => {
  const up = await request.get('http://localhost:8000/api/health').then((r) => r.ok(), () => false)
  test.skip(!up || !process.env.API_LOG, 'Needs the API server on localhost:8000 and API_LOG (see backend/README.md).')
})

function linkFor(email: string): string | undefined {
  const log = readFileSync(process.env.API_LOG!, 'utf8')
  const start = log.lastIndexOf(`Email to ${email}`)
  return start < 0 ? undefined : log.slice(start).match(/http\S+\/reset-password#\S+/)?.[0]
}

test('forgot password → emailed link → new password → signed in; the old password stops working', async ({ page }, info) => {
  const email = `reset-${Date.now()}-${info.project.name}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Your name').fill('Reset Student')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('guitar-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('button', { name: 'Account: Reset Student' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()

  await page.goto('/signin')
  await page.getByLabel('Email').fill(email)
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await page.getByRole('button', { name: 'Send me the link' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible()

  await expect.poll(() => linkFor(email)).toBeTruthy()
  const link = new URL(linkFor(email)!)
  await page.goto(link.pathname + link.hash)
  await expect(page.getByText(`For ${email}.`)).toBeVisible()
  await page.getByLabel('New password', { exact: true }).fill('new-guitar-1')
  await page.getByRole('button', { name: 'Save new password' }).click()
  await expect(page.getByTestId('welcome-banner')).toContainText('Your new password is saved.')

  // The link worked once.
  await page.goto(link.pathname + link.hash)
  await expect(page.getByRole('alert')).toContainText('expired or was already used')

  await page.getByRole('button', { name: 'Account: Reset Student' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.goto('/signin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('guitar-123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.')
  await page.getByLabel('Password').fill('new-guitar-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'Account: Reset Student' })).toBeVisible()
})
