import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })

async function useDayTwo(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('scoopaloo_save_v1', JSON.stringify({ version: 1, currentDay: 1 })))
}

async function expectInsideViewport(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  expect(box!.y + box!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
}

test('shows a readable order, times out, and freezes a missed goal', async ({ page }) => {
  await useDayTwo(page)
  await page.goto('/')
  await expect(page.getByRole('img', { name: 'Scoopaloo' })).toBeVisible()
  const goal = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    return state.skin.days[state.save.currentDay].cashGoal
  })
  await expect(page.getByRole('heading', { name: `$${goal} GOAL` })).toBeVisible()
  const start = page.getByRole('button', { name: 'START SHIFT' })
  await expect(start).toBeVisible()
  expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expectInsideViewport(page, '.ready-card')
  await page.screenshot({ path: 'test-results/shift-phone-ready.png' })

  await start.click()
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await expect(page.getByLabel('Shift status')).toBeVisible()
  const current = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const front = state.customers.find(customer => !customer.served && !customer.missed)!
    const seconds = Math.ceil(state.shift.remaining)
    return {
      label: front.order.label,
      price: front.order.price,
      clock: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    }
  })
  await expect(page.getByLabel('Current order')).toContainText(current.label)
  await expect(page.getByLabel('Current order')).toContainText(`$${current.price}`)
  await expect(page.getByText(current.clock, { exact: true })).toBeVisible()
  await expectInsideViewport(page, '.shift-hud')
  await expectInsideViewport(page, '.order-ticket')

  const minimumType = await page.locator('.hud-stat span').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  expect(minimumType).toBeGreaterThanOrEqual(13)
  await page.screenshot({ path: 'test-results/shift-phone-playing.png' })

  await page.evaluate(() => window.__scoopaloo.advance(window.__scoopaloo.snapshot().shift.remaining))
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
  await useDayTwo(page)
  await page.goto('/')
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(true)
    game.startShift()
    const station = (key: 'counter' | 'register') => {
      const [x, y] = game.snapshot().skin.stations[key].interaction
      return { x, y }
    }
    const prepare = (item: string) => {
      const recipe = game.snapshot().skin.items[item].recipe!
      for (const [input, quantity] of Object.entries(recipe.inputs)) {
        const state = game.snapshot()
        const producer = Object.values(state.skin.producers).find(candidate => candidate.item === input)!
        const target = (state.player.trayItems[input] ?? 0) + quantity
        game.movePlayer({ x: producer.interaction[0], y: producer.interaction[1] })
        for (let tick = 0; tick < 100 && (game.snapshot().player.trayItems[input] ?? 0) < target; tick++) game.advance(.2)
      }
      const before = game.snapshot().player.trayItems[item] ?? 0
      const prep = game.snapshot().skin.prepStations[recipe.station].interaction
      game.movePlayer({ x: prep[0], y: prep[1] })
      for (let tick = 0; tick < 100 && (game.snapshot().player.trayItems[item] ?? 0) <= before; tick++) game.advance(.2)
    }
    for (let round = 0; round < 12 && game.snapshot().shift.revenue < game.snapshot().skin.days[game.snapshot().save.currentDay].cashGoal; round++) {
      const state = game.snapshot()
      const front = state.customers.find(customer => !customer.served && !customer.missed)
      if (!front) { game.advance(.1); continue }
      for (let item = 0; item < front.order.quantity; item++) {
        prepare(front.order.item)
        const carried = game.snapshot().player.trayItems[front.order.item] ?? 0
        game.movePlayer(station('counter'))
        for (let tick = 0; tick < 20 && (game.snapshot().player.trayItems[front.order.item] ?? 0) >= carried; tick++) game.advance(.1)
      }
      game.advance(1)
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
