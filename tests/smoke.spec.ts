import { expect, test } from '@playwright/test'

test('boots and completes the coin loop', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  const result = await page.evaluate(() => {
    const game = window.__scoopaloo
    game.advance(2)
    game.movePlayer({ x: 190, y: 260 })
    game.advance(4)
    game.movePlayer({ x: 620, y: 335 })
    game.advance(2)
    game.movePlayer({ x: 760, y: 335 })
    game.advance(4)
    return game.snapshot().lifetimeCoins
  })
  expect(result).toBeGreaterThan(0)
})
