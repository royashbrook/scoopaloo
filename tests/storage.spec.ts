import { expect, test } from '@playwright/test'

test('boots without storage access and keeps playing when autosave is denied', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new DOMException('denied', 'SecurityError') },
    })
  })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => Boolean(window.__scoopaloo))).toBe(true)
  await page.evaluate(() => window.__scoopaloo.startShift())
  await page.waitForTimeout(1400)
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().time)).toBeGreaterThan(1.1)
  expect(errors).toEqual([])
})

test('continues the frame loop after a quota failure', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
  })
  await page.goto('/')
  await page.evaluate(() => window.__scoopaloo.startShift())
  await page.waitForTimeout(1600)
  const first = await page.evaluate(() => window.__scoopaloo.snapshot().time)
  await page.waitForTimeout(350)
  const second = await page.evaluate(() => window.__scoopaloo.snapshot().time)
  expect(first).toBeGreaterThan(1.2)
  expect(second - first).toBeGreaterThan(.2)
  expect(errors).toEqual([])
})
