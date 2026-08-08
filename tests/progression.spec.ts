import { expect, test } from '@playwright/test'

// Issue 12's acceptance: with text off and a fresh save, earn and buy all three
// upgrades in one session, each with an observable mechanical effect. Runs the
// real built game; deterministic time through the advance hook.
test('completes the wordless purchase path with all three effects', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()

  const result = await page.evaluate(async () => {
    const game = window.__scoopaloo
    const skin = game.snapshot().skin
    const [machineSpot, counterSpot] = [skin.stations.machine.interaction, skin.stations.counter.interaction]

    // measured walk speed: one second of pure rightward input from a fixed point
    const measureSpeed = () => {
      game.movePlayer({ x: 200, y: 470 })
      const before = game.snapshot().player.x
      game.advance(1, { x: 1, y: 0 })
      return game.snapshot().player.x - before
    }
    const speedBefore = measureSpeed()

    // farm the loop until an upgrade is affordable, then stand on its spot
    const buy = (spot: number[], price: number) => {
      for (let round = 0; round < 60 && game.snapshot().save.coins < price; round++) {
        game.movePlayer({ x: machineSpot[0], y: machineSpot[1] })
        game.advance(4)
        game.movePlayer({ x: counterSpot[0], y: counterSpot[1] })
        game.advance(6)
      }
      game.movePlayer({ x: spot[0], y: spot[1] })
      game.advance(1)
    }

    const [shoes, tray, machine] = skin.upgrades
    buy(shoes.spot, shoes.price)
    const speedAfter = measureSpeed()

    buy(tray.spot, tray.price)
    // capacity: park at the machine and let the tray fill
    game.movePlayer({ x: machineSpot[0], y: machineSpot[1] })
    game.advance(10)
    const trayLoad = game.snapshot().player.tray

    buy(machine.spot, machine.price)
    // interval: the timer is re-armed to the upgraded interval after a pour
    game.movePlayer({ x: 480, y: 600 })
    game.advance(5)
    const timer = game.snapshot().machine.timer

    const save = game.snapshot().save
    return { speedBefore, speedAfter, trayLoad, timer, upgrades: save.upgrades, stations: save.unlockedStations }
  })

  expect(result.upgrades).toEqual({ shoes: 1, tray: 1, machine: 1 })
  expect(result.speedAfter).toBeGreaterThan(result.speedBefore + 15) // +25 speed, tolerance for clamp
  expect(result.trayLoad).toBe(3) // capacity 2 + 1
  expect(result.timer).toBeLessThanOrEqual(1.7 - 0.45 + 0.01)
  expect(result.stations).toContain('turbo-churner')
})
