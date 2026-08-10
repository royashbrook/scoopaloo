import { expect, test, type Page } from '@playwright/test'
import { tipFor } from '../src/engine'

type Point = { x: number; y: number }

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })

async function dragTo(page: Page, target: Point): Promise<void> {
  const origin = { x: 195, y: 760 }
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  try {
    for (let tick = 0; tick < 350; tick++) {
      const next = await page.evaluate(goal => {
        const state = window.__scoopaloo.snapshot()
        const dx = goal.x - state.player.x
        const dy = goal.y - state.player.y
        return { dx, dy, distance: Math.hypot(dx, dy), phase: state.phase }
      }, target)
      if (next.distance < 52) return
      if (next.phase !== 'playing') throw new Error(`shift ended before reaching ${target.x},${target.y}`)
      await page.mouse.move(origin.x + next.dx / next.distance * 58, origin.y + next.dy / next.distance * 58)
      await page.waitForTimeout(35)
    }
    throw new Error(`pointer route did not reach ${target.x},${target.y}`)
  } finally {
    await page.mouse.up()
  }
}

async function collectFrom(page: Page, item: string): Promise<void> {
  const target = await page.evaluate(id => {
    const producer = Object.values(window.__scoopaloo.snapshot().skin.producers)
      .find(candidate => candidate.item === id)!
    return { x: producer.interaction[0], y: producer.interaction[1] }
  }, item)
  if (target.y > 1000) await dragTo(page, { x: 480, y: target.y })
  await dragTo(page, target)
}

async function finishDayOne(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = window.__scoopaloo
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const prepare = (item: string) => {
      const recipe = game.snapshot().skin.items[item].recipe!
      for (const [input, quantity] of Object.entries(recipe.inputs)) {
        const state = game.snapshot()
        const producer = Object.values(state.skin.producers).find(candidate => candidate.item === input)!
        const target = (state.player.trayItems[input] ?? 0) + quantity
        game.movePlayer(point(producer.interaction))
        for (let tick = 0; tick < 100 && (game.snapshot().player.trayItems[input] ?? 0) < target; tick++) game.advance(.2)
      }
      const before = game.snapshot().player.trayItems[item] ?? 0
      game.movePlayer(point(game.snapshot().skin.prepStations[recipe.station].interaction))
      for (let tick = 0; tick < 100 && (game.snapshot().player.trayItems[item] ?? 0) <= before; tick++) game.advance(.2)
    }
    game.pause(true)
    for (let round = 0; round < 12 && game.snapshot().shift.revenue < game.snapshot().rules.cashGoal; round++) {
      const front = game.snapshot().customers.find(customer => !customer.served && !customer.missed)
      if (!front) { game.advance(.1); continue }
      for (let made = 0; made < front.order.quantity; made++) {
        prepare(front.order.item)
        const carried = game.snapshot().player.trayItems[front.order.item] ?? 0
        game.movePlayer(point(game.snapshot().skin.stations.counter.interaction))
        for (let tick = 0; tick < 20 && (game.snapshot().player.trayItems[front.order.item] ?? 0) >= carried; tick++) game.advance(.1)
      }
      game.advance(1)
      game.movePlayer(point(game.snapshot().skin.stations.register.interaction))
      game.advance(3)
    }
    game.advance(game.snapshot().shift.remaining)
  })
  await expect(page.getByRole('heading', { name: 'SHIFT COMPLETE' })).toBeVisible()
  await page.getByRole('button', { name: 'UPGRADES' }).click()
  await page.getByRole('button', { name: 'NEXT DAY' }).click()
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await page.evaluate(() => {
    window.__scoopaloo.pause(true)
    window.__scoopaloo.advance(window.__scoopaloo.snapshot().rules.spawnInterval + .05)
  })
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
    }
    const panel = box('.order-panel')
    const ticket = box('.order-ticket')
    const rail = box('.next-orders')
    const rows = [...document.querySelectorAll<HTMLElement>('.next-orders li')].map(row => {
      const state = row.querySelector<HTMLElement>('.next-state')!
      const quantity = row.querySelector<HTMLElement>('b')!
      const stateBox = state.getBoundingClientRect()
      const quantityBox = quantity.getBoundingClientRect()
      return {
        state: row.dataset.state,
        font: parseFloat(getComputedStyle(state).fontSize),
        stateFits: state.scrollWidth <= state.clientWidth,
        rowFits: row.scrollWidth <= row.clientWidth,
        labelsClear: stateBox.right <= quantityBox.left || quantityBox.right <= stateBox.left
          || stateBox.bottom <= quantityBox.top || quantityBox.bottom <= stateBox.top,
        height: row.getBoundingClientRect().height,
      }
    })
    const inside = (rect: ReturnType<typeof box>) => rect.left >= 0 && rect.top >= 0
      && rect.right <= innerWidth && rect.bottom <= innerHeight
    const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    return {
      panel, ticket, rail, rows,
      inside: [panel, ticket, rail].every(inside),
      clear: !overlaps(ticket, rail),
      railBeforeTicket: rail.right <= ticket.left,
      ticketBeforeRail: ticket.right <= rail.left,
    }
  })
}

function includesSequence(values: number[], sequence: number[]): boolean {
  return values.some((_, start) => sequence.every((value, offset) => values[start + offset] === value))
}

test('serves the second open order by pointer while keeping the front ticket', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    const frequencies: number[] = []
    Object.defineProperty(window, '__openCounterFrequencies', { value: frequencies })
    class Param {
      constructor(private readonly record = false) {}
      setValueAtTime(value: number) { if (this.record) frequencies.push(value); return this }
      exponentialRampToValueAtTime() { return this }
    }
    class TestAudioContext {
      currentTime = 0
      state = 'suspended'
      destination = {}
      resume() { this.state = 'running'; return Promise.resolve() }
      createOscillator() {
        return { type: 'sine', frequency: new Param(true), connect: () => {}, start: () => {}, stop: () => {} }
      }
      createGain() { return { gain: new Param(), connect: () => {} } }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: TestAudioContext })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await page.evaluate(() => {
    window.__scoopaloo.pause(true)
    window.__scoopaloo.advance(2.05)
  })
  const dayOneNext = page.getByLabel('Upcoming orders').locator('li').first()
  await expect(dayOneNext).toHaveAttribute('data-state', 'waiting')
  await expect(dayOneNext.locator('.next-state')).toBeVisible()
  await expect(dayOneNext.locator('.next-state')).toHaveText('WAIT')
  await expect(dayOneNext).toHaveAttribute('aria-label', /waiting outside the active service window/)
  await finishDayOne(page)

  const route = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const waiting = state.customers.filter(customer => !customer.served && !customer.missed)
    const [front, target] = waiting
    const recipe = state.skin.items[target.order.item].recipe!
    return {
      window: state.rules.activeOrderWindow,
      front: { id: front.id, item: front.order.item, label: front.order.label },
      target: { id: target.id, item: target.order.item, label: target.order.label, price: target.order.price },
      inputs: Object.entries(recipe.inputs).flatMap(([item, count]) => Array(count).fill(item)),
      prep: state.skin.prepStations[recipe.station].interaction,
      counter: state.skin.stations.counter.interaction,
    }
  })
  expect(route.window).toBe(2)
  expect(route.target.item).not.toBe(route.front.item)
  await expect(page.getByLabel('Current order')).toContainText(route.front.label)

  const rows = page.getByLabel('Upcoming orders').locator('li')
  await expect(rows.first()).toHaveAttribute('data-state', 'actionable')
  await expect(rows.first().locator('.next-state')).toHaveText('NOW')
  await expect(rows.first()).toHaveAttribute('aria-label', /actionable now, \d+ seconds remaining/)
  await expect(rows.nth(1)).toHaveAttribute('data-state', 'preview')
  await expect(rows.nth(1).locator('.next-state')).toHaveText('SOON')
  await expect(rows.nth(1)).toHaveAttribute('aria-label', /preview only.*not spawned.*cannot be served yet/)
  await expect(page.getByLabel('Upcoming orders').getByRole('button')).toHaveCount(0)
  const railBefore = await rows.evaluateAll(items => items.map(item => (item as HTMLElement).dataset.label))

  const phone = await layout(page)
  expect(phone.panel.width).toBeCloseTo(390 - 24, 0)
  expect(phone.ticket.width).toBeCloseTo(308, 0)
  expect(phone.ticket.height).toBe(132)
  expect(phone.rail.width).toBeCloseTo(52, 0)
  expect(phone.inside && phone.clear && phone.railBeforeTicket).toBe(true)
  for (const row of phone.rows) {
    expect(row, row.state).toMatchObject({ height: 51, font: 13, stateFits: true, rowFits: true, labelsClear: true })
  }
  await page.screenshot({ path: 'test-results/open-counter-phone-actionable.png' })

  await page.evaluate(() => window.__scoopaloo.pause(false))
  for (const input of route.inputs) await collectFrom(page, input)
  await dragTo(page, { x: route.prep[0], y: route.prep[1] })
  await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, route.target.item), {
    timeout: 8_000,
  }).toBe(1)

  const soundStart = await page.evaluate(() =>
    (window as unknown as { __openCounterFrequencies: number[] }).__openCounterFrequencies.length)
  await dragTo(page, { x: route.counter[0], y: route.counter[1] })
  await expect.poll(() => page.evaluate(id =>
    window.__scoopaloo.snapshot().customers.find(customer => customer.id === id)?.served ?? false,
  route.target.id), { timeout: 4_000 }).toBe(true)
  await page.evaluate(() => window.__scoopaloo.pause(true))

  const outcome = await page.evaluate(({ frontId, targetId }) => {
    const state = window.__scoopaloo.snapshot()
    const front = state.customers.find(customer => customer.id === frontId)!
    const target = state.customers.find(customer => customer.id === targetId)!
    const pay = [...state.events].reverse().find(event => event.kind === 'pay')!
    return {
      front: { served: front.served, missed: front.missed, patience: front.patience },
      target: { served: target.served, patience: target.patience },
      patienceMax: state.rules.customerPatience,
      served: state.shift.served,
      pay: { item: pay.item, amount: pay.amount, tip: pay.tip, combo: pay.combo, streak: pay.streak },
      wrong: state.events.some(event => event.kind === 'reject' && event.reason === 'wrong-item'),
      coins: state.flyingCoins.map(coin => coin.value),
    }
  }, { frontId: route.front.id, targetId: route.target.id })
  const expectedTip = tipFor(outcome.target.patience, outcome.patienceMax)
  expect(outcome.front.served || outcome.front.missed).toBe(false)
  expect(outcome).toMatchObject({ target: { served: true }, served: 1, wrong: false })
  expect(outcome.pay).toEqual({
    item: route.target.item,
    amount: route.target.price + expectedTip,
    tip: expectedTip,
    combo: 0,
    streak: 1,
  })
  expect(outcome.coins).toHaveLength(4)
  expect(outcome.coins.reduce((sum, value) => sum + value, 0)).toBe(outcome.pay.amount)
  await expect(page.getByLabel('Current order')).toContainText(route.front.label)
  await expect(page.locator('.order-ticket')).not.toHaveClass(/is-wrong/)

  const heard = await page.evaluate(start =>
    (window as unknown as { __openCounterFrequencies: number[] }).__openCounterFrequencies.slice(start), soundStart)
  expect(includesSequence(heard, [360, 740, 990])).toBe(true)
  expect(heard.filter(value => value === 740)).toHaveLength(1)
  expect(heard.filter(value => value === 990)).toHaveLength(1)
  expect(heard.some(value => value === 150 || value === 120)).toBe(false)

  const railAfter = await rows.evaluateAll(items => items.map(item => (item as HTMLElement).dataset.label))
  expect(railAfter).not.toEqual(railBefore)
  await page.screenshot({ path: 'test-results/open-counter-phone-served.png' })

  for (const size of [
    { name: 'tablet', width: 768, height: 1024, railFirst: true },
    { name: 'desktop', width: 1440, height: 900, railFirst: false },
  ]) {
    await page.setViewportSize(size)
    await page.waitForTimeout(50)
    const resized = await layout(page)
    expect(resized.inside && resized.clear).toBe(true)
    expect(resized.railBeforeTicket).toBe(size.railFirst)
    expect(resized.ticketBeforeRail).toBe(!size.railFirst)
    for (const row of resized.rows) {
      expect(row.font, `${size.name} ${row.state}`).toBeGreaterThanOrEqual(13)
      expect(row, `${size.name} ${row.state}`).toMatchObject({ stateFits: true, rowFits: true, labelsClear: true })
    }
    await page.screenshot({ path: `test-results/open-counter-${size.name}.png` })
  }
})
