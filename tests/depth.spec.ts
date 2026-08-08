import { expect, test } from '@playwright/test'
import { depthScale, FAR_SCALE, NEAR_SCALE } from '../src/depth'

// Issue 14's evidence run: reduced motion, paused engine, deterministic
// placements. Far/near are visual PLAYER placements; stations stay put, and
// interaction happens at native anchors through the real world-distance rules.
test.use({ reducedMotion: 'reduce' })

test('depth scale, overlap boundary, and native-anchor interaction', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  // deterministic scene (#14): pause the real clock immediately, wait for the
  // atlas, then advance SIM time far enough that every spawned customer has
  // converged onto its queue target, and pin the display clock to one instant.
  // from here identical runs produce identical pixels.
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
  await page.evaluate(() => {
    window.__scoopaloo.advance(24)
    window.__scoopaloo.setTime(1)
  })

  // scale endpoints through the same exported helpers the renderer uses
  expect(depthScale(210)).toBe(FAR_SCALE)
  expect(depthScale(595)).toBe(NEAR_SCALE)

  const counterDepth = await page.evaluate(() => window.__scoopaloo.snapshot().skin.stations.counter.depth)

  const capture = async (name: string, x: number, y: number) => {
    await page.evaluate(([px, py]) => {
      window.__scoopaloo.movePlayer({ x: px, y: py })
      window.__scoopaloo.setTime(1) // re-pin: nothing between captures may drift the clock
    }, [x, y])
    await page.waitForTimeout(120) // two frames: paused loop still renders
    await page.screenshot({ path: `test-results/depth-${name}.png` })
  }
  await capture('far', 480, 215)
  await capture('near', 480, 590)
  await capture('behind-counter', 620, counterDepth - 1)
  await capture('in-front', 620, counterDepth + 1)

  // interaction invariance: the scaled machine's ground anchor is still its
  // interaction point, and the real loop works at native anchors while the
  // depth transform is live on screen
  const worked = await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(false)
    const skin = game.snapshot().skin
    const [mx, my] = skin.stations.machine.interaction
    const [cx, cy] = skin.stations.counter.interaction
    game.movePlayer({ x: mx, y: my })
    game.advance(4)
    const carried = game.snapshot().player.tray
    game.movePlayer({ x: cx, y: cy })
    game.advance(2)
    // customers may serve (and consume) the delivery within these two seconds,
    // so the proof of the drop is the emptied tray, not the counter's stock
    const after = game.snapshot()
    return { carried, trayAfter: after.player.tray, throughput: after.counter.stock + after.flyingCoins.length + after.lifetimeCoins }
  })
  expect(worked.carried).toBeGreaterThan(0)
  expect(worked.trayAfter).toBe(0)
  expect(worked.throughput).toBeGreaterThan(0)

  // outside the interaction radius nothing happens, scale or no scale
  const outside = await page.evaluate(() => {
    const game = window.__scoopaloo
    const [mx, my] = game.snapshot().skin.stations.machine.interaction
    game.movePlayer({ x: mx + 120, y: my + 120 })
    const before = game.snapshot().player.tray
    game.advance(3)
    return game.snapshot().player.tray - before
  })
  expect(outside).toBe(0)
})
