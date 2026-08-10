import { expect, test, type Page } from '@playwright/test'
import { SAVE_KEY } from '../src/save'

const PHONES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'air', width: 420, height: 912 },
] as const

const LEGACY_DAY_TWO = {
  version: 1,
  currentDay: 1,
  unlockedStations: ['soft-scoop', 'cone-shell', 'sundae-cup', 'build-station'],
}

type Point = { x: number; y: number }
type Move = (target: Point) => Promise<void>

test.use({ reducedMotion: 'reduce' })

async function setPhoneSafeArea(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-top', '59px')
    document.documentElement.style.setProperty('--safe-bottom', '34px')
    dispatchEvent(new Event('resize'))
  })
  await page.waitForTimeout(50)
}

async function expectPaintedCanvas(page: Page, originX: number, playerMustBeVisible = true): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.viewport().originX)).toBe(originX)
  const report = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!
    const context = canvas.getContext('2d')!
    const box = canvas.getBoundingClientRect()
    const view = window.__scoopaloo.viewport()
    const opaque = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[3] === 255
    return {
      box: { width: Math.round(box.width), height: Math.round(box.height) },
      window: { width: innerWidth, height: innerHeight },
      playerVisible: window.__scoopaloo.snapshot().player.x >= view.originX
        && window.__scoopaloo.snapshot().player.x <= view.originX + view.viewWidth,
      horizontalBackdrop: view.originX >= -416 && view.originX + view.viewWidth <= 1376,
      corners: [
        opaque(0, 0), opaque(canvas.width - 1, 0),
        opaque(0, canvas.height - 1), opaque(canvas.width - 1, canvas.height - 1),
      ],
    }
  })
  expect(report.box).toEqual(report.window)
  if (playerMustBeVisible) expect(report.playerVisible).toBe(true)
  expect(report.horizontalBackdrop).toBe(true)
  expect(report.corners).toEqual([true, true, true, true])
}

async function withHeldJoystick(
  page: Page,
  route: (move: Move, stop: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const size = page.viewportSize()!
  const origin = { x: size.width / 2, y: size.height - 84 }
  const stop = () => page.mouse.move(origin.x, origin.y)
  const move: Move = async target => {
    for (let tick = 0; tick < 420; tick++) {
      const next = await page.evaluate(goal => {
        const state = window.__scoopaloo.snapshot()
        const dx = goal.x - state.player.x
        const dy = goal.y - state.player.y
        return { dx, dy, distance: Math.hypot(dx, dy), phase: state.phase }
      }, target)
      if (next.distance < 50) {
        await stop()
        return
      }
      if (next.phase !== 'playing') throw new Error(`shift ended before reaching ${target.x},${target.y}`)
      await page.mouse.move(
        origin.x + next.dx / next.distance * 60,
        origin.y + next.dy / next.distance * 60,
      )
      await page.waitForTimeout(35)
    }
    throw new Error(`held pointer route did not reach ${target.x},${target.y}`)
  }

  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  try {
    await route(move, stop)
  } finally {
    await page.mouse.up()
  }
}

async function finishBaseDayTwo(page: Page): Promise<{
  revenue: number
  goal: number
  stars: number
  upgrades: Record<string, number>
}> {
  return page.evaluate(() => {
    const game = window.__scoopaloo
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const serveFront = () => {
      const state = game.snapshot()
      const front = state.customers.find(customer => !customer.served && !customer.missed)
      if (!front) { game.advance(.1); return }
      const recipe = state.skin.items[front.order.item].recipe!
      for (let made = 0; made < front.order.quantity && game.snapshot().phase === 'playing'; made++) {
        for (const [input, quantity] of Object.entries(recipe.inputs)) {
          const current = game.snapshot()
          const producer = Object.values(current.skin.producers).find(candidate => candidate.item === input)!
          const target = (current.player.trayItems[input] ?? 0) + quantity
          game.movePlayer(point(producer.interaction))
          for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
            && (game.snapshot().player.trayItems[input] ?? 0) < target; tick++) game.advance(.2)
        }
        const before = game.snapshot().player.trayItems[front.order.item] ?? 0
        game.movePlayer(point(state.skin.prepStations[recipe.station].interaction))
        for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
          && (game.snapshot().player.trayItems[front.order.item] ?? 0) <= before; tick++) game.advance(.2)
        const carried = game.snapshot().player.trayItems[front.order.item] ?? 0
        game.movePlayer(point(state.skin.stations.counter.interaction))
        for (let tick = 0; tick < 20 && game.snapshot().phase === 'playing'
          && (game.snapshot().player.trayItems[front.order.item] ?? 0) >= carried; tick++) game.advance(.1)
      }
      game.advance(1.6)
    }

    for (let order = 0; order < 40 && game.snapshot().phase === 'playing'
      && game.snapshot().shift.revenue < game.snapshot().rules.cashGoal; order++) serveFront()
    const beforeEnd = game.snapshot()
    if (beforeEnd.phase === 'playing') game.advance(beforeEnd.shift.remaining)
    const finished = game.snapshot()
    return {
      revenue: finished.shift.revenue,
      goal: finished.rules.cashGoal,
      stars: finished.shift.stars,
      upgrades: finished.save.upgrades,
    }
  })
}

for (const size of PHONES) {
  test(`Day 1 visibly locks Chocolate Corner at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size)
    await page.goto('/')
    await setPhoneSafeArea(page)
    await page.waitForFunction(() => window.__scoopaloo.atlasReady())
    await page.evaluate(() => {
      window.__scoopaloo.pause(true)
      window.__scoopaloo.startShift()
      window.__scoopaloo.pause(false)
    })

    const x = size.width / 2
    const y = size.height - 84
    await page.mouse.move(x, y)
    await page.mouse.down()
    try {
      await page.mouse.move(x + 70, y)
      await page.waitForTimeout(1_700)
    } finally {
      await page.mouse.up()
    }
    await page.evaluate(() => window.__scoopaloo.pause(true))

    const locked = await page.evaluate(() => {
      const state = window.__scoopaloo.snapshot()
      return {
        annex: state.skin.room.annex,
        playerX: state.player.x,
        active: 'chocolate-scoop' in state.sources,
        unlocked: state.save.unlockedStations.includes('chocolate-scoop'),
      }
    })
    expect(locked.annex).toEqual({
      label: 'CHOCOLATE CORNER',
      unlockStation: 'chocolate-scoop',
      boundaryX: 780,
      doorway: [770, 320, 20, 800],
    })
    expect(locked.playerX).toBeCloseTo(725, 0)
    expect(locked).toMatchObject({ active: false, unlocked: false })
    await expectPaintedCanvas(page, 320)
    await page.screenshot({ path: `test-results/chocolate-day1-locked-${size.name}.png` })
  })

  test(`legacy Day 2 opens and traverses Chocolate Corner at ${size.width}x${size.height}`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize(size)
    await page.addInitScript(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
      key: SAVE_KEY,
      save: LEGACY_DAY_TWO,
    })
    await page.goto('/')
    await setPhoneSafeArea(page)
    await page.waitForFunction(() => window.__scoopaloo.atlasReady())
    await page.evaluate(() => {
      window.__scoopaloo.pause(true)
      window.__scoopaloo.startShift()
      window.__scoopaloo.movePlayer({ x: 55, y: 880 })
    })

    expect(await page.evaluate(() => {
      const state = window.__scoopaloo.snapshot()
      return {
        version: state.save.version,
        day: state.save.currentDay,
        active: 'chocolate-scoop' in state.sources,
        unlocked: state.save.unlockedStations.includes('chocolate-scoop'),
        goal: state.rules.cashGoal,
        patience: state.rules.customerPatience,
        frontPatience: state.customers[0]?.patience,
        upgrades: Object.values(state.save.upgrades),
      }
    })).toEqual({
      version: 1,
      day: 1,
      active: true,
      unlocked: true,
      goal: 60,
      patience: 32,
      frontPatience: 32,
      upgrades: [0, 0, 0, 0, 0],
    })

    const marker = page.locator('.needed-marker')
    await expectPaintedCanvas(page, 0)
    await expect(marker).toBeVisible()
    await expect(marker).toHaveAttribute('data-direction', 'right')
    await expect(marker).toHaveAttribute('aria-label', 'CHOCOLATE ingredient is offscreen to the right')
    await expect(marker.locator('img')).toHaveAttribute('src', '/assets/items/chocolate-scoop.svg')
    await page.screenshot({ path: `test-results/chocolate-day2-west-${size.name}.png` })

    const route = await page.evaluate(() => {
      const state = window.__scoopaloo.snapshot()
      const recipe = state.skin.items['chocolate-cone'].recipe!
      const source = (item: string) => {
        const station = Object.values(state.skin.producers).find(candidate => candidate.item === item)!
        return point(station.interaction)
      }
      const point = (values: number[]) => ({ x: values[0], y: values[1] })
      return {
        chocolate: source('chocolate-scoop'),
        cone: source('cone-shell'),
        prep: point(state.skin.prepStations[recipe.station].interaction),
        counter: point(state.skin.stations.counter.interaction),
      }
    })

    await page.evaluate(() => window.__scoopaloo.pause(false))
    await withHeldJoystick(page, async (move, stop) => {
      // Stay above the vessel row so the real west-to-east route cannot pick
      // up the cone before the offscreen guidance has a chance to flip left.
      await move({ x: 480, y: 800 })
      await move({ x: 780, y: 800 })
      await move(route.chocolate)
      await expect.poll(() => page.evaluate(() =>
        window.__scoopaloo.snapshot().player.trayItems['chocolate-scoop'] ?? 0)).toBe(1)
      await stop()
      await expectPaintedCanvas(page, 320)
      await expect(marker).toBeVisible()
      await expect(marker).toHaveAttribute('data-direction', 'left')
      await expect(marker).toHaveAttribute('aria-label', 'CONE ingredient is offscreen to the left')
      await expect(marker.locator('img')).toHaveAttribute('src', '/assets/items/cone-shell.svg')
      await page.screenshot({ path: `test-results/chocolate-day2-east-${size.name}.png` })

      await move({ x: 480, y: 1070 })
      await move({ x: 480, y: 920 })
      await move(route.cone)
      await expect.poll(() => page.evaluate(() =>
        window.__scoopaloo.snapshot().player.trayItems['cone-shell'] ?? 0)).toBe(1)
      await expect(marker).toBeHidden()

      await move({ x: 480, y: 920 })
      await move(route.prep)
      await expect.poll(() => page.evaluate(() =>
        window.__scoopaloo.snapshot().player.trayItems['chocolate-cone'] ?? 0), { timeout: 4_000 }).toBe(1)
      await move(route.counter)
      await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().shift.served), {
        timeout: 3_000,
      }).toBe(1)
    })
    await page.evaluate(() => window.__scoopaloo.pause(true))

    const firstRoute = await page.evaluate(() => {
      const state = window.__scoopaloo.snapshot()
      const served = state.customers.find(customer => customer.served)
      return {
        served: state.shift.served,
        missed: state.shift.missed,
        remaining: state.shift.remaining,
        servedWithPatience: (served?.patience ?? 0) > 0,
      }
    })
    expect(firstRoute).toMatchObject({ served: 1, missed: 0, servedWithPatience: true })
    expect(firstRoute.remaining).toBeGreaterThan(50)

    const result = await finishBaseDayTwo(page)
    expect(result.upgrades).toEqual({ shoes: 0, tray: 0, machine: 0, patience: 0, helper: 0 })
    expect(result.revenue).toBeGreaterThanOrEqual(result.goal)
    expect(result.stars).toBeGreaterThanOrEqual(1)
    await page.screenshot({ path: `test-results/chocolate-day2-complete-${size.name}.png` })
  })
}

test('tablet and desktop stay centered while phone-only camera focus changes', async ({ page }) => {
  await page.addInitScript(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
    key: SAVE_KEY,
    save: LEGACY_DAY_TWO,
  })
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/')
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
  await page.evaluate(() => {
    window.__scoopaloo.pause(true)
    window.__scoopaloo.startShift()
  })

  for (const size of [
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size)
    await page.evaluate(() => dispatchEvent(new Event('resize')))
    await page.evaluate(() => window.__scoopaloo.movePlayer({ x: 55, y: 880 }))
    await page.waitForTimeout(50)
    const west = await page.evaluate(() => window.__scoopaloo.viewport())
    await page.evaluate(() => window.__scoopaloo.movePlayer({ x: 905, y: 880 }))
    await page.waitForTimeout(50)
    const east = await page.evaluate(() => window.__scoopaloo.viewport())
    const centered = (960 - west.viewWidth) / 2
    expect(west.originX, size.name).toBeCloseTo(centered, 6)
    expect(east.originX, size.name).toBeCloseTo(centered, 6)
    await expectPaintedCanvas(page, west.originX, false)
    await page.screenshot({ path: `test-results/chocolate-${size.name}-centered.png` })
  }
})
