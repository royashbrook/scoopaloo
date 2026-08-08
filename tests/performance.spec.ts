import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true })

test('keeps a 60 fps frame budget at tablet size', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
  const loaded = await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(true)
    game.startShift()
    const state = game.snapshot()
    const sources = Object.entries(state.skin.producers)
      .filter(([id]) => id in state.sources)
      .slice(0, 2)
    for (const [, source] of sources) {
      const item = source.item
      const before = game.snapshot().player.trayItems[item] ?? 0
      game.movePlayer({ x: source.interaction[0], y: source.interaction[1] })
      for (let tick = 0; tick < 50 && (game.snapshot().player.trayItems[item] ?? 0) === before; tick++) game.advance(.2)
    }
    game.movePlayer({ x: 480, y: 880 })
    game.pause(false)
    return game.snapshot().player.tray
  })
  expect(loaded).toBe(2)

  // Exercise the expensive live case: a loaded tray and an active walk pose.
  await page.mouse.move(384, 760)
  await page.mouse.down()
  await page.mouse.move(444, 760)
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().player.moving)).toBe(true)
  const frameTimes = await page.evaluate(() => new Promise<number[]>(resolve => {
    const samples: number[] = []
    let previous = performance.now()
    const sample = (now: number) => {
      samples.push(now - previous)
      previous = now
      if (samples.length === 90) resolve(samples.slice(5))
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  frameTimes.sort((a, b) => a - b)
  const p95 = frameTimes[Math.floor(frameTimes.length * .95)]
  await page.mouse.up()
  expect(p95).toBeLessThan(25)
})
