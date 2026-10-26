import { expect, test } from '@playwright/test'

// Full stack: the real API server (backend/, on http://localhost:8000) through the dev server's
// /api forwarding, with real cookies. Skipped when that server is not running.
const API = 'http://localhost:8000/api/health'

test.beforeAll(async ({ request }) => {
  const up = await request.get(API).then((r) => r.ok(), () => false)
  test.skip(!up, 'The API server is not running on localhost:8000 (see backend/README.md).')
})

test('create an account, stay signed in after reload, sign out, sign in again', async ({ page }, info) => {
  const email = `e2e-${Date.now()}-${info.project.name}@example.com`
  await page.goto('/songs')
  await page.getByRole('link', { name: 'Sign in' }).click()
  await page.getByRole('link', { name: 'Create a free account' }).click()

  await page.getByLabel('Your name').fill('Test Student')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('guitar-123')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('button', { name: 'Account: Test Student' })).toHaveText('TS')
  await expect(page.getByTestId('welcome-banner')).toContainText('Welcome to the academy, Test Student!')
  await expect(page).toHaveURL(/\/songs$/)

  // The session cookie keeps you signed in after a reload.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Account: Test Student' })).toBeVisible()

  // Sign out (also on the server): still signed out after a reload.
  await page.getByRole('button', { name: 'Account: Test Student' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()

  // A wrong password, then the right one.
  await page.getByRole('link', { name: 'Sign in' }).click()
  await page.getByLabel('Email').fill(email.toUpperCase())
  await page.getByLabel('Password').fill('wrong-pass')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.')
  await page.getByLabel('Password').fill('guitar-123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('button', { name: 'Account: Test Student' })).toBeVisible()
  await expect(page.getByTestId('welcome-banner')).toContainText('Welcome back, Test Student!')
})

test('the same email cannot be used twice', async ({ page, request }, info) => {
  const email = `e2e-dup-${Date.now()}-${info.project.name}@example.com`
  const first = await request.post('/api/auth/signup', {
    headers: { 'X-Requested-With': 'fetch' },
    data: { name: 'First', email, password: 'guitar-123' },
  })
  expect(first.status()).toBe(201)
  await page.goto('/signup')
  await page.getByLabel('Your name').fill('Second')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('guitar-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('alert')).toContainText('An account with this email already exists.')
})
