import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })

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
  await page.goto('/')
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await page.evaluate(() => window.__scoopaloo.pause(true))

  const wrong = await page.evaluate(() => {
    const game = window.__scoopaloo
    const moveTo = (target: { x: number; y: number }) => {
      while (game.snapshot().phase === 'playing') {
        const player = game.snapshot().player
        const dx = target.x - player.x
        const dy = target.y - player.y
        const distance = Math.hypot(dx, dy)
        if (distance < 20) break
        game.advance(.05, { x: dx / distance, y: dy / distance })
      }
    }
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const serveFront = () => {
      const state = game.snapshot()
      const front = state.customers.find(customer => !customer.served && !customer.missed)!
      const source = state.skin.items[front.order.item].recipe.source
      moveTo(point(state.skin.producers[source].interaction))
      while (game.snapshot().phase === 'playing') {
        const current = game.snapshot()
        const active = current.customers.find(customer => customer.id === front.id && !customer.served && !customer.missed)
        if (!active || (current.player.trayItems[front.order.item] ?? 0) >= front.order.quantity) break
        game.advance(.2)
      }
      moveTo(point(state.skin.stations.counter.interaction))
      game.advance(1.4)
    }

    game.advance(4)
    serveFront()
    serveFront()
    const mixed = game.snapshot()
    const front = mixed.customers.find(customer => !customer.served && !customer.missed)!
    const wrongItem = Object.keys(mixed.skin.items).find(item => item !== front.order.item)!
    const wrongSource = mixed.skin.items[wrongItem].recipe.source
    moveTo(point(mixed.skin.producers[wrongSource].interaction))
    for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
      && (game.snapshot().player.trayItems[wrongItem] ?? 0) < 1; tick++) game.advance(.2)

    // Route around the other producer so the tray contains only the deliberate
    // wrong product when proximity delivery begins.
    moveTo({ x: 420, y: 560 })
    const before = game.snapshot()
    moveTo(point(mixed.skin.stations.counter.interaction))
    const after = game.snapshot()
    const active = after.customers.find(customer => !customer.served && !customer.missed)!
    return {
      before: { time: before.time, patience: before.customers.find(customer => customer.id === front.id)!.patience, served: before.shift.served },
      after: { time: after.time, patience: active.patience, served: after.shift.served },
      frontId: front.id,
      activeId: active.id,
      expectedItem: front.order.item,
      wrongItem,
      wrongStock: after.counter.items[wrongItem] ?? 0,
    }
  })

  expect(wrong.activeId).toBe(wrong.frontId)
  expect(wrong.after.served).toBe(wrong.before.served)
  expect(wrong.wrongStock).toBeGreaterThan(0)
  expect(wrong.after.patience).toBeCloseTo(wrong.before.patience - (wrong.after.time - wrong.before.time), 4)
  await expect(page.getByText('WRONG ITEM', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/orders-phone-wrong.png' })

  const result = await page.evaluate(({ expectedItem, wrongItem }) => {
    const game = window.__scoopaloo
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const moveTo = (target: { x: number; y: number }) => {
      while (game.snapshot().phase === 'playing') {
        const player = game.snapshot().player
        const dx = target.x - player.x
        const dy = target.y - player.y
        const distance = Math.hypot(dx, dy)
        if (distance < 20) break
        game.advance(.05, { x: dx / distance, y: dy / distance })
      }
    }
    const serveFront = () => {
      const state = game.snapshot()
      const front = state.customers.find(customer => !customer.served && !customer.missed)
      if (!front) { game.advance(.1); return }
      const source = state.skin.items[front.order.item].recipe.source
      moveTo(point(state.skin.producers[source].interaction))
      while (game.snapshot().phase === 'playing') {
        const current = game.snapshot()
        const active = current.customers.find(customer => customer.id === front.id && !customer.served && !customer.missed)
        if (!active || (current.player.trayItems[front.order.item] ?? 0) >= front.order.quantity) break
        game.advance(.2)
      }
      moveTo(point(state.skin.stations.counter.interaction))
      game.advance(1.4)
    }

    const servedBefore = game.snapshot().shift.served
    serveFront()
    const recovered = game.snapshot()
    while (game.snapshot().phase === 'playing') serveFront()
    const finished = game.snapshot()
    return {
      recoveredServed: recovered.shift.served,
      servedBefore,
      wrongStillStored: recovered.counter.items[wrongItem] ?? 0,
      requested: expectedItem,
      phase: finished.phase,
      revenue: finished.shift.revenue,
      goal: finished.skin.shift.cashGoal,
      served: finished.shift.served,
      stars: finished.shift.stars,
    }
  }, { expectedItem: wrong.expectedItem, wrongItem: wrong.wrongItem })

  expect(result.recoveredServed).toBeGreaterThan(result.servedBefore)
  expect(result.wrongStillStored).toBeGreaterThanOrEqual(1)
  expect(result.phase).toBe('results')
  expect(result.revenue).toBeGreaterThanOrEqual(result.goal)
  expect(result.served).toBeGreaterThanOrEqual(6)
  expect(result.stars).toBeGreaterThanOrEqual(1)
  await expect(page.getByRole('heading', { name: 'SHIFT COMPLETE' })).toBeVisible()
  await page.screenshot({ path: 'test-results/orders-phone-success.png' })
})

test('shows typed tray and counter stock without status overlap at every target size', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(true)
    game.advance(4)
    const state = game.snapshot()
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const moveTo = (target: { x: number; y: number }) => {
      while (game.snapshot().phase === 'playing') {
        const player = game.snapshot().player
        const dx = target.x - player.x
        const dy = target.y - player.y
        const distance = Math.hypot(dx, dy)
        if (distance < 20) break
        game.advance(.05, { x: dx / distance, y: dy / distance })
      }
    }
    const itemIds = Object.keys(state.skin.items)
    for (const item of itemIds) {
      const source = state.skin.items[item].recipe.source
      moveTo(point(state.skin.producers[source].interaction))
      for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
        && (game.snapshot().player.trayItems[item] ?? 0) < 1; tick++) game.advance(.2)
      game.movePlayer({ x: 420, y: 560 })
      game.advance(.05)
    }
    moveTo(point(state.skin.stations.counter.interaction))
    game.movePlayer({ x: 480, y: 520 })
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
