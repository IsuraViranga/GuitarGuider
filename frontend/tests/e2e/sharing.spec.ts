import { expect, test, type Browser, type Page } from '@playwright/test'

// Full stack: needs the API server on http://localhost:8000 and the e2e admin account
// (see songs.spec.ts). Skipped otherwise.

test.beforeAll(async ({ request }) => {
  const up = await request.get('http://localhost:8000/api/health').then((r) => r.ok(), () => false)
  test.skip(!up, 'The API server is not running on localhost:8000 (see backend/README.md).')
})

async function student(browser: Browser, project: string): Promise<Page> {
  const page = await browser.newPage()
  await page.goto('/signup')
  await page.getByLabel('Your name').fill('Share Student')
  await page.getByLabel('Email').fill(`share-${Date.now()}-${project}@example.com`)
  await page.getByLabel('Password').fill('guitar-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('button', { name: 'Account: Share Student' })).toBeVisible()
  return page
}

async function admin(browser: Browser): Promise<Page> {
  const page = await browser.newPage()
  await page.goto('/signin')
  await page.getByLabel('Email').fill('e2e-admin@example.com')
  await page.getByLabel('Password').fill('admin-pass-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  const ok = await page.getByRole('button', { name: 'Account: E2E Admin' }).waitFor({ timeout: 8000 }).then(() => true, () => false)
  test.skip(!ok, 'No e2e admin account in the local database.')
  return page
}

test('share → rejected with a reason → shared again → approved into the global list', async ({ browser }, info) => {
  const title = `Shared Song ${Date.now()}-${info.project.name}`
  const me = await student(browser, info.project.name)

  // Add a song and share it.
  await me.goto('/import')
  await me.getByLabel('Paste the song here').fill('23 23 15\nTwin kle, twin')
  await me.getByLabel('Song title').fill(title)
  await me.getByRole('button', { name: 'Check song' }).click()
  await me.getByRole('button', { name: 'Save and practise' }).click()
  await me.goto('/songs?list=mine')
  await me.getByRole('button', { name: `Share ${title} with everyone` }).click()
  await me.getByRole('button', { name: 'Send to admin' }).click()
  const myCard = me.getByRole('listitem').filter({ hasText: title })
  await expect(myCard.getByTestId('share-status')).toContainText('Waiting for the admin’s review')

  // The admin rejects it with a reason.
  const boss = await admin(browser)
  await boss.goto('/songs?list=requests')
  await boss.getByRole('link', { name: `Review ${title}` }).click()
  await expect(boss.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await boss.getByRole('button', { name: /Reject$/ }).click()
  await boss.getByLabel(/Reason for Share Student/).fill('Please add the second line.')
  await boss.getByRole('button', { name: 'Reject song' }).click()
  await expect(boss.getByRole('heading', { level: 1, name: 'Not accepted' })).toBeVisible()

  // The student sees why, and shares again.
  await me.reload()
  await expect(myCard.getByTestId('share-status')).toContainText('Admin: “Please add the second line.”')
  await me.getByRole('button', { name: `Share ${title} with everyone` }).click()
  await me.getByRole('button', { name: 'Send to admin' }).click()
  await expect(myCard.getByTestId('share-status')).toContainText('Waiting')

  // The admin approves it.
  await boss.goto('/songs?list=requests')
  await boss.getByRole('link', { name: `Review ${title}` }).click()
  await boss.getByRole('button', { name: /Approve/ }).click()
  await expect(boss.getByRole('heading', { level: 1, name: 'Shared with everyone!' })).toBeVisible()

  // Everyone sees it in the global set list; the student's card says it was shared.
  const visitor = await browser.newPage()
  await visitor.goto('/songs')
  await expect(visitor.getByRole('link', { name: title, exact: true })).toBeVisible()
  await me.reload()
  await expect(myCard.getByTestId('share-status')).toContainText('Shared with everyone')

  // Tidy up: the admin deletes the global copy.
  await boss.goto('/songs')
  await boss.getByRole('button', { name: `Delete ${title}` }).click()
  await boss.getByRole('button', { name: 'Yes, delete it' }).click()
  await expect(boss.getByRole('link', { name: title, exact: true })).toHaveCount(0)
})

test('edit and approve publishes the admin’s corrected version', async ({ browser }, info) => {
  const title = `Needs Fix ${Date.now()}-${info.project.name}`
  const me = await student(browser, info.project.name)
  await me.goto('/import')
  await me.getByLabel('Paste the song here').fill('10 11 13')
  await me.getByLabel('Song title').fill(title)
  await me.getByRole('button', { name: 'Check song' }).click()
  await me.getByRole('button', { name: 'Save and practise' }).click()
  await me.goto('/songs?list=mine')
  await me.getByRole('button', { name: `Share ${title} with everyone` }).click()
  await me.getByRole('button', { name: 'Send to admin' }).click()
  await expect(me.getByRole('listitem').filter({ hasText: title }).getByTestId('share-status')).toContainText('Waiting')

  const boss = await admin(browser)
  await boss.goto('/songs?list=requests')
  await boss.getByRole('link', { name: `Review ${title}` }).click()
  await boss.getByRole('link', { name: /Edit and approve/ }).click()
  await expect(boss.getByLabel('Paste the song here')).toHaveValue('10 11 13')
  await boss.getByLabel('Song title').fill(`${title} (fixed)`)
  await boss.getByRole('button', { name: 'Check song' }).click()
  await boss.getByRole('button', { name: 'Approve with these changes' }).click()
  await expect(boss.getByText(`“${title} (fixed)” is now shared with everyone.`)).toBeVisible()

  await boss.goto('/songs')
  await expect(boss.getByRole('link', { name: `${title} (fixed)`, exact: true })).toBeVisible()
  await boss.getByRole('button', { name: `Delete ${title} (fixed)` }).click()
  await boss.getByRole('button', { name: 'Yes, delete it' }).click()
})
