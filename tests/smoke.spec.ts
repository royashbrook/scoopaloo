import { expect, test } from '@playwright/test'

test('boots and completes the coin loop', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  const result = await page.evaluate(() => {
    const game = window.__scoopaloo
    const station = (key: 'counter' | 'register') => {
      const [x, y] = game.snapshot().skin.stations[key].interaction
      return { x, y }
    }
    game.startShift()
    game.advance(2)
    const state = game.snapshot()
    const item = state.customers[0].order.item
    const recipe = state.skin.items[item].recipe!
    for (const [input, quantity] of Object.entries(recipe.inputs)) {
      const producer = Object.values(state.skin.producers).find(candidate => candidate.item === input)!
      game.movePlayer({ x: producer.interaction[0], y: producer.interaction[1] })
      for (let tick = 0; tick < 50 && (game.snapshot().player.trayItems[input] ?? 0) < quantity; tick++) game.advance(.2)
    }
    const prep = state.skin.prepStations[recipe.station].interaction
    game.movePlayer({ x: prep[0], y: prep[1] })
    for (let tick = 0; tick < 50 && (game.snapshot().player.trayItems[item] ?? 0) < 1; tick++) game.advance(.2)
    game.movePlayer(station('counter'))
    game.advance(2)
    game.movePlayer(station('register'))
    game.advance(4)
    return game.snapshot().save.lifetimeCash
  })
  expect(result).toBeGreaterThan(0)
})
