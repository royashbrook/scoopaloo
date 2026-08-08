import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })

async function expectInsideViewport(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  expect(box!.y + box!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
}

test('shows a readable order, times out, and freezes a missed goal', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('img', { name: 'Scoopaloo' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '$60 GOAL' })).toBeVisible()
  const start = page.getByRole('button', { name: 'START SHIFT' })
  await expect(start).toBeVisible()
  expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expectInsideViewport(page, '.ready-card')
  await page.screenshot({ path: 'test-results/shift-phone-ready.png' })

  await start.click()
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await expect(page.getByLabel('Shift status')).toBeVisible()
  await expect(page.getByLabel('Current order')).toContainText('VANILLA CONE')
  await expect(page.getByLabel('Current order')).toContainText('$6')
  await expect(page.getByText('1:30', { exact: true })).toBeVisible()
  await expectInsideViewport(page, '.shift-hud')
  await expectInsideViewport(page, '.order-ticket')

  const minimumType = await page.locator('.hud-stat span').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  expect(minimumType).toBeGreaterThanOrEqual(13)
  await page.screenshot({ path: 'test-results/shift-phone-playing.png' })

  await page.evaluate(() => window.__scoopaloo.advance(90))
  await expect(page.getByRole('heading', { name: 'GOAL MISSED' })).toBeVisible()
  await expect(page.locator('.results-card').getByText('$0', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'RETRY' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'UPGRADES' })).toBeEnabled()
  await expectInsideViewport(page, '.results-card')
  await page.screenshot({ path: 'test-results/shift-phone-missed.png' })

  const before = await page.evaluate(() => window.__scoopaloo.snapshot())
  await page.evaluate(() => window.__scoopaloo.advance(10))
  const after = await page.evaluate(() => window.__scoopaloo.snapshot())
  expect(after).toEqual(before)
})

test('earns a real goal and keeps results readable at every target size', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(true)
    game.startShift()
    const station = (key: 'counter' | 'register') => {
      const [x, y] = game.snapshot().skin.stations[key].interaction
      return { x, y }
    }
    for (let round = 0; round < 12 && game.snapshot().shift.revenue < game.snapshot().skin.days[game.snapshot().save.currentDay].cashGoal; round++) {
      const state = game.snapshot()
      const front = state.customers.find(customer => !customer.served && !customer.missed)
      if (!front) { game.advance(.1); continue }
      const source = state.skin.items[front.order.item].recipe.source
      const [x, y] = state.skin.producers[source].interaction
      game.movePlayer({ x, y })
      game.advance(4)
      game.movePlayer(station('counter'))
      game.advance(2)
      game.movePlayer(station('register'))
      game.advance(3)
    }
    game.advance(game.snapshot().shift.remaining)
  })

  await expect(page.getByRole('heading', { name: 'SHIFT COMPLETE' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'REPLAY' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'UPGRADES' })).toBeEnabled()
  const state = await page.evaluate(() => window.__scoopaloo.snapshot())
  expect(state.shift.revenue).toBeGreaterThanOrEqual(state.skin.days[state.save.currentDay].cashGoal)
  expect(state.shift.stars).toBeGreaterThanOrEqual(1)

  for (const size of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.waitForTimeout(100)
    await expectInsideViewport(page, '.results-card')
    await page.screenshot({ path: `test-results/shift-${size.name}-success.png` })
  }
})
