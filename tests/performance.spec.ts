import { expect, test } from '@playwright/test'
import { build } from 'vite'

test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true })

test('keeps the loaded-walk frame-time regression canary below 25 ms at tablet size', async ({ page }) => {
  await page.goto('/')
  expect(await page.evaluate(() => '__scoopaloo' in window)).toBe(true)
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

  // Regression canary, not a 60 fps guarantee: exercise the expensive live
  // case with a loaded tray and an active walk pose.
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

test('keeps the browser test hook out of the normal production bundle', async () => {
  const result = await build({ mode: 'production', logLevel: 'silent', build: { write: false, emptyOutDir: false } })
  const code = (Array.isArray(result) ? result : [result])
    .flatMap(output => 'output' in output ? output.output : [])
    .map(output => output.type === 'chunk' ? output.code : '')
    .join('\n')
  expect(code).not.toContain('__scoopaloo')
})
