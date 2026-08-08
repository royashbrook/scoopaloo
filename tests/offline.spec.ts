import { expect, test } from '@playwright/test'

test('reloads offline after the first visit', async ({ context, page }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()

  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()
  await context.setOffline(false)
})
