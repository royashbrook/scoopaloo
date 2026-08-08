import { expect, test } from '@playwright/test'

test('boots and completes the coin loop', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  const result = await page.evaluate(() => {
    const game = window.__scoopaloo
    const station = (key: 'machine' | 'counter' | 'register') => {
      const [x, y] = game.snapshot().skin.stations[key].interaction
      return { x, y }
    }
    game.startShift()
    game.advance(2)
    game.movePlayer(station('machine'))
    game.advance(4)
    game.movePlayer(station('counter'))
    game.advance(2)
    game.movePlayer(station('register'))
    game.advance(4)
    return game.snapshot().save.lifetimeCash
  })
  expect(result).toBeGreaterThan(0)
})
