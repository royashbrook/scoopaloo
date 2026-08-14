import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })

async function useDayTwo(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('scoopaloo_save_v1', JSON.stringify({ version: 1, currentDay: 1 })))
}

async function expectStatusLayout(page: Page): Promise<void> {
  const boxes = await page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    }
    return { hud: box('.shift-hud'), ticket: box('.order-ticket'), save: box('#save-button'), width: innerWidth, height: innerHeight }
  })
  const inside = (box: typeof boxes.hud) => box.left >= 0 && box.top >= 0 && box.right <= boxes.width && box.bottom <= boxes.height
  const intersects = (a: typeof boxes.hud, b: typeof boxes.hud) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  expect(inside(boxes.hud)).toBe(true)
  expect(inside(boxes.ticket)).toBe(true)
  expect(inside(boxes.save)).toBe(true)
  expect(intersects(boxes.hud, boxes.ticket)).toBe(false)
  expect(intersects(boxes.hud, boxes.save)).toBe(false)
  expect(intersects(boxes.ticket, boxes.save)).toBe(false)
}

test('rejects wrong stock, recovers, and completes the deterministic mixed deck', async ({ page }) => {
  await useDayTwo(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await page.evaluate(() => window.__scoopaloo.pause(true))

  const wrong = await page.evaluate(() => {
    const game = window.__scoopaloo
    const moveTo = (target: { x: number; y: number }) => {
      game.movePlayer(target)
    }
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const prepareOne = (item: string) => {
      const recipe = game.snapshot().skin.items[item].recipe!
      for (const [input, quantity] of Object.entries(recipe.inputs)) {
        const current = game.snapshot()
        const producer = Object.values(current.skin.producers).find(candidate => candidate.item === input)!
        const target = (current.player.trayItems[input] ?? 0) + quantity
        moveTo(point(producer.interaction))
        for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
          && (game.snapshot().player.trayItems[input] ?? 0) < target; tick++) game.advance(.2)
      }
      const before = game.snapshot().player.trayItems[item] ?? 0
      moveTo(point(game.snapshot().skin.prepStations[recipe.station].interaction))
      for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
        && (game.snapshot().player.trayItems[item] ?? 0) <= before; tick++) game.advance(.2)
    }
    const serveFront = () => {
      const state = game.snapshot()
      const front = state.customers.find(customer => !customer.served && !customer.missed)!
      for (let made = 0; made < front.order.quantity && game.snapshot().phase === 'playing'; made++) {
        prepareOne(front.order.item)
        const carried = game.snapshot().player.trayItems[front.order.item] ?? 0
        moveTo(point(state.skin.stations.counter.interaction))
        for (let tick = 0; tick < 20 && game.snapshot().phase === 'playing'
          && (game.snapshot().player.trayItems[front.order.item] ?? 0) >= carried; tick++) game.advance(.1)
      }
      game.advance(1)
    }

    game.advance(4)
    serveFront()
    serveFront()
    const mixed = game.snapshot()
    const front = mixed.customers.find(customer => !customer.served && !customer.missed)!
    const activeItems = new Set(mixed.customers
      .filter(customer => !customer.served && !customer.missed)
      .slice(0, mixed.rules.activeOrderWindow)
      .map(customer => customer.order.item))
    const wrongItem = Object.keys(mixed.skin.items)
      .find(item => !activeItems.has(item) && mixed.skin.items[item].recipe)!
    prepareOne(wrongItem)

    // Leave every interaction ring before measuring the deliberate wrong drop.
    moveTo({ x: 480, y: 880 })
    const before = game.snapshot()
    moveTo(point(mixed.skin.stations.counter.interaction))
    for (let tick = 0; tick < 20 && (game.snapshot().counter.items[wrongItem] ?? 0) < 1; tick++) game.advance(.1)
    const after = game.snapshot()
    const active = after.customers.find(customer => !customer.served && !customer.missed)!
    return {
      before: { time: before.time, patience: before.customers.find(customer => customer.id === front.id)!.patience, served: before.shift.served },
      after: { time: after.time, patience: active.patience, served: after.shift.served },
      frontId: front.id,
      activeId: active.id,
      wrongStock: after.counter.items[wrongItem] ?? 0,
    }
  })

  expect(wrong.activeId).toBe(wrong.frontId)
  expect(wrong.after.served).toBe(wrong.before.served)
  expect(wrong.wrongStock).toBeGreaterThan(0)
  expect(wrong.after.patience).toBeCloseTo(wrong.before.patience - (wrong.after.time - wrong.before.time), 4)
  await expect(page.getByText('WRONG ITEM', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/orders-phone-wrong.png' })

  const result = await page.evaluate(() => {
    const game = window.__scoopaloo
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const moveTo = (target: { x: number; y: number }) => {
      game.movePlayer(target)
    }
    const prepareOne = (item: string) => {
      const recipe = game.snapshot().skin.items[item].recipe!
      for (const [input, quantity] of Object.entries(recipe.inputs)) {
        const current = game.snapshot()
        const producer = Object.values(current.skin.producers).find(candidate => candidate.item === input)!
        const target = (current.player.trayItems[input] ?? 0) + quantity
        moveTo(point(producer.interaction))
        for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
          && (game.snapshot().player.trayItems[input] ?? 0) < target; tick++) game.advance(.2)
      }
      const before = game.snapshot().player.trayItems[item] ?? 0
      moveTo(point(game.snapshot().skin.prepStations[recipe.station].interaction))
      for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
        && (game.snapshot().player.trayItems[item] ?? 0) <= before; tick++) game.advance(.2)
    }
    const serveFront = () => {
      const state = game.snapshot()
      const front = state.customers.find(customer => !customer.served && !customer.missed)
      if (!front) { game.advance(.1); return }
      for (let made = 0; made < front.order.quantity && game.snapshot().phase === 'playing'; made++) {
        prepareOne(front.order.item)
        const carried = game.snapshot().player.trayItems[front.order.item] ?? 0
        moveTo(point(state.skin.stations.counter.interaction))
        for (let tick = 0; tick < 20 && game.snapshot().phase === 'playing'
          && (game.snapshot().player.trayItems[front.order.item] ?? 0) >= carried; tick++) game.advance(.1)
      }
      game.advance(1)
    }

    const servedBefore = game.snapshot().shift.served
    serveFront()
    const recovered = game.snapshot()
    while (game.snapshot().phase === 'playing') serveFront()
    const finished = game.snapshot()
    return {
      recoveredServed: recovered.shift.served,
      servedBefore,
      phase: finished.phase,
      revenue: finished.shift.revenue,
      goal: finished.skin.days[finished.save.currentDay].cashGoal,
      served: finished.shift.served,
      stars: finished.shift.stars,
    }
  })

  expect(result.recoveredServed).toBeGreaterThan(result.servedBefore)
  expect(result.phase).toBe('results')
  expect(result.revenue).toBeGreaterThanOrEqual(result.goal)
  expect(result.served).toBeGreaterThanOrEqual(6)
  expect(result.stars).toBeGreaterThanOrEqual(1)
  await expect(page.getByRole('heading', { name: 'SHIFT COMPLETE' })).toBeVisible()
  await page.screenshot({ path: 'test-results/orders-phone-success.png' })
})

test('shows typed tray and counter stock without status overlap at every target size', async ({ page }) => {
  await useDayTwo(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(true)
    game.advance(4)
    const state = game.snapshot()
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const prepareOne = (item: string) => {
      const recipe = game.snapshot().skin.items[item].recipe!
      for (const [input, quantity] of Object.entries(recipe.inputs)) {
        const current = game.snapshot()
        const producer = Object.values(current.skin.producers).find(candidate => candidate.item === input)!
        const target = (current.player.trayItems[input] ?? 0) + quantity
        game.movePlayer(point(producer.interaction))
        for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
          && (game.snapshot().player.trayItems[input] ?? 0) < target; tick++) game.advance(.2)
      }
      const before = game.snapshot().player.trayItems[item] ?? 0
      game.movePlayer(point(game.snapshot().skin.prepStations[recipe.station].interaction))
      for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
        && (game.snapshot().player.trayItems[item] ?? 0) <= before; tick++) game.advance(.2)
    }
    const front = state.customers.find(customer => !customer.served && !customer.missed)!
    const activeItems = new Set(state.customers
      .filter(customer => !customer.served && !customer.missed)
      .slice(0, state.rules.activeOrderWindow)
      .map(customer => customer.order.item))
    const wrong = Object.keys(state.skin.items).find(item => !activeItems.has(item) && state.skin.items[item].recipe)!
    game.stockCounter({ [wrong]: 1 })
    prepareOne(front.order.item)
    game.movePlayer({ x: 480, y: 880 })
    game.advance(.05)
  })
  await page.waitForTimeout(100)
  const inventory = await page.evaluate(() => ({
    tray: window.__scoopaloo.snapshot().player.trayItems,
    counter: window.__scoopaloo.snapshot().counter.items,
  }))
  expect(Object.values(inventory.tray).some(count => count > 0)).toBe(true)
  expect(Object.values(inventory.counter).some(count => count > 0)).toBe(true)
  const visibleKinds = new Set([
    ...Object.entries(inventory.tray).filter(([, count]) => count > 0).map(([item]) => item),
    ...Object.entries(inventory.counter).filter(([, count]) => count > 0).map(([item]) => item),
  ])
  expect(visibleKinds.size).toBe(2)

  for (const size of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.waitForTimeout(100)
    await expectStatusLayout(page)
    await page.screenshot({ path: `test-results/orders-${size.name}-stock.png` })
  }
})
