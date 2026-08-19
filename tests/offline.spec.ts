import { expect, test } from '@playwright/test'

test('reloads offline after the first visit', async ({ context, page }) => {
  await page.goto('/')
  const worker = await page.evaluate(async () => (await fetch('/sw.js')).text())
  expect(worker).toContain("const CACHE = 'scoopaloo-v17'")
  expect(worker).toContain("'/assets/room/ice-cream-wall.svg?v=3'")
  expect(worker).toContain("'/assets/player-walk.webp?v=2'")
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()

  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()
  const room = await page.evaluate(async () => {
    const response = await fetch('/assets/room/ice-cream-wall.svg?v=3')
    const svg = await response.text()
    return {
      ok: response.ok,
      type: response.headers.get('content-type'),
      corner: svg.includes('id="chocolate-corner-floor"') && svg.includes('id="chocolate-corner-wall"'),
    }
  })
  expect(room).toMatchObject({ ok: true, corner: true })
  expect(room.type).toContain('image/svg+xml')
  expect(await page.evaluate(async () => Boolean(await caches.match('/assets/player-walk.webp?v=2')))).toBe(true)
  await context.setOffline(false)
})
