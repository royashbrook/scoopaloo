import { expect, test, type Page } from '@playwright/test'

type OrderView = { label: string; icon: string; quantity: number }

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'no-preference' })

async function useDayTwo(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('scoopaloo_save_v1', JSON.stringify({ version: 1, currentDay: 1 })))
}

async function expectedUpcoming(page: Page): Promise<OrderView[]> {
  return page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const waiting = state.customers.filter(customer => !customer.served && !customer.missed)
    const orders = waiting.slice(1, 3).map(customer => customer.order)
    const day = state.skin.days[state.save.currentDay]
    for (let index = state.nextOrder; orders.length < 2; index++) {
      const request = day.orderDeck[index % day.orderDeck.length]
      const item = state.skin.items[request.item]
      orders.push({ ...request, label: item.label, price: item.price * request.quantity, icon: item.icon, color: item.color })
    }
    return orders.map(order => ({ label: order.label, icon: order.icon, quantity: order.quantity }))
  })
}

async function visibleUpcoming(page: Page): Promise<OrderView[]> {
  return page.locator('[data-field="upcoming-orders"] li').evaluateAll(items => items.map(item => {
    const icon = item.querySelector<HTMLImageElement>('img')!
    return {
      label: (item as HTMLElement).dataset.label!,
      icon: new URL(icon.src).pathname,
      quantity: Number((item as HTMLElement).dataset.quantity),
    }
  }))
}

async function expectUpcoming(page: Page): Promise<OrderView[]> {
  const expected = await expectedUpcoming(page)
  await expect.poll(() => visibleUpcoming(page)).toEqual(expected)
  return expected
}

async function serveFront(page: Page) {
  return page.evaluate(() => {
    const game = window.__scoopaloo
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const prepareOne = (item: string) => {
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

    const before = game.snapshot()
    const front = before.customers.find(customer => !customer.served && !customer.missed)
    if (!front) throw new Error('no customer to serve')
    for (let made = 0; made < front.order.quantity; made++) {
      prepareOne(front.order.item)
      const carried = game.snapshot().player.trayItems[front.order.item] ?? 0
      game.movePlayer(point(game.snapshot().skin.stations.counter.interaction))
      for (let tick = 0; tick < 30 && (game.snapshot().player.trayItems[front.order.item] ?? 0) >= carried; tick++) game.advance(.1)
    }
    for (let tick = 0; tick < 30 && game.snapshot().shift.served === before.shift.served; tick++) game.advance(.05)

    const after = game.snapshot()
    const pay = [...after.events].reverse().find(event => event.kind === 'pay')
    if (!pay?.amount) throw new Error('serve produced no payout')
    return {
      basePrice: front.order.price,
      revenueBefore: before.shift.revenue,
      cashBefore: before.save.coins,
      lifetimeBefore: before.save.lifetimeCash,
      revenueAfterServe: after.shift.revenue,
      streak: after.shift.streak,
      pay: { amount: pay.amount, tip: pay.tip ?? 0, combo: pay.combo ?? 0, streak: pay.streak ?? 0 },
      coins: after.flyingCoins.map(coin => coin.value),
    }
  })
}

async function collectCoins(page: Page) {
  return page.evaluate(() => {
    const game = window.__scoopaloo
    game.movePlayer({ x: 55, y: 1150 })
    game.advance(.6)
    const held = game.snapshot()
    const register = held.skin.stations.register.interaction
    game.movePlayer({ x: register[0], y: register[1] })
    for (let tick = 0; tick < 100 && game.snapshot().flyingCoins.length > 0; tick++) game.advance(.05)
    const collected = game.snapshot()
    return {
      heldRevenue: held.shift.revenue,
      heldCoins: held.flyingCoins.map(coin => coin.value),
      revenue: collected.shift.revenue,
      cash: collected.save.coins,
      lifetime: collected.save.lifetimeCash,
      coinsLeft: collected.flyingCoins.length,
    }
  })
}

async function frequencies(page: Page): Promise<number[]> {
  return page.evaluate(() => [...(window as unknown as { __strategyFrequencies: number[] }).__strategyFrequencies])
}

function includesSequence(values: number[], sequence: number[]): boolean {
  return values.some((_, start) => sequence.every((value, offset) => values[start + offset] === value))
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
    const hud = box('.shift-hud')
    const save = box('#save-button')
    const sound = box('#sound-button')
    const inside = (rect: ReturnType<typeof box>) => rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
    const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
    return {
      viewport: { width: innerWidth, height: innerHeight },
      panel, ticket, rail,
      allInside: [panel, ticket, rail, hud, save, sound].every(inside),
      clear: !overlaps(ticket, rail) && !overlaps(panel, hud) && !overlaps(panel, save) && !overlaps(panel, sound),
      railBeforeTicket: rail.right <= ticket.left,
      ticketBeforeRail: ticket.right <= rail.left,
      headingFont: parseFloat(style('.next-heading').fontSize),
      positionFont: parseFloat(style('.next-position').fontSize),
      quantityFont: parseFloat(style('.next-orders b').fontSize),
      iconWidth: box('.next-orders img').width,
      railLive: document.querySelector('.next-orders')!.hasAttribute('aria-live'),
      panelEndsWithTicket: Math.abs(panel.bottom - ticket.bottom),
    }
  })
}

test('plans two orders ahead and makes combo money an audible mobile stake', async ({ page }) => {
  test.setTimeout(30_000)
  await useDayTwo(page)
  await page.addInitScript(() => {
    const recorded: number[] = []
    Object.defineProperty(window, '__strategyFrequencies', { value: recorded })
    class Param {
      constructor(private readonly record = false) {}
      setValueAtTime(value: number) { if (this.record) recorded.push(value); return this }
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
    window.__scoopaloo.advance(10.05) // spawn customer two so a real serve advances the preview
  })

  const front = await page.evaluate(() => {
    const customer = window.__scoopaloo.snapshot().customers.find(item => !item.served && !item.missed)!
    return { label: customer.order.label, quantity: customer.order.quantity }
  })
  await expect(page.getByLabel('Current order')).toContainText(front.label)
  await expect(page.getByLabel('Current order')).toContainText(`×${front.quantity}`)
  const initialPreview = await expectUpcoming(page)
  await expect(page.getByLabel('Upcoming orders').locator('li')).toHaveCount(2)
  await expect(page.getByLabel('Upcoming orders')).not.toHaveAttribute('aria-live')

  const phone = await layout(page)
  expect(phone.allInside).toBe(true)
  expect(phone.clear).toBe(true)
  expect(phone.panel.width).toBeCloseTo(390 - 24, 0)
  expect(phone.ticket.width).toBeCloseTo(308, 0)
  expect(phone.rail.width).toBeCloseTo(52, 0)
  expect(phone.ticket.left - phone.rail.right).toBeCloseTo(6, 0)
  expect(phone.railBeforeTicket).toBe(true)
  expect(phone.ticket.height).toBe(132)
  expect(phone.rail.bottom).toBeLessThanOrEqual(phone.ticket.bottom)
  expect(phone.panelEndsWithTicket).toBeLessThanOrEqual(1)
  expect(phone.headingFont).toBeGreaterThanOrEqual(13)
  expect(phone.positionFont).toBeGreaterThanOrEqual(13)
  expect(phone.quantityFont).toBeGreaterThanOrEqual(13)
  expect(phone.iconWidth).toBeGreaterThanOrEqual(28)
  expect(phone.railLive).toBe(false)

  const first = await serveFront(page)
  expect(first.streak).toBe(1)
  const afterServePreview = await expectUpcoming(page)
  expect(afterServePreview).not.toEqual(initialPreview)
  await collectCoins(page)

  const soundStart = (await frequencies(page)).length
  const second = await serveFront(page)
  expect(second.streak).toBe(2)
  expect(second.pay).toEqual({
    amount: second.basePrice + second.pay.tip + 2,
    tip: second.pay.tip,
    combo: 2,
    streak: 2,
  })
  expect(second.coins).toHaveLength(4)
  expect(second.coins.reduce((total, coin) => total + coin, 0)).toBe(second.pay.amount)
  expect(second.revenueAfterServe).toBe(second.revenueBefore)

  await expect(page.locator('.combo-score')).toHaveText('2/4 +$2')
  await expect(page.locator('.hud-combo')).toHaveClass(/is-gain/, { timeout: 500 })
  await expect.poll(async () => includesSequence((await frequencies(page)).slice(soundStart), [587, 740, 988])).toBe(true)
  await page.screenshot({ path: 'test-results/strategy-phone-tier.png' })

  const collected = await collectCoins(page)
  expect(collected.heldRevenue).toBe(second.revenueBefore)
  expect(collected.heldCoins.reduce((total, coin) => total + coin, 0)).toBe(second.pay.amount)
  expect(collected.coinsLeft).toBe(0)
  expect(collected.revenue - second.revenueBefore).toBe(second.pay.amount)
  expect(collected.cash - second.cashBefore).toBe(second.pay.amount)
  expect(collected.lifetime - second.lifetimeBefore).toBe(second.pay.amount)

  await page.evaluate(() => {
    const game = window.__scoopaloo
    for (let tick = 0; tick < 100 && !game.snapshot().customers.some(item => !item.served && !item.missed); tick++) game.advance(.2)
  })
  const beforeMissPreview = await expectUpcoming(page)
  const breakSoundStart = (await frequencies(page)).length
  const missed = await page.evaluate(() => {
    const game = window.__scoopaloo
    const front = game.snapshot().customers.find(customer => !customer.served && !customer.missed)!
    game.movePlayer({ x: 55, y: 1150 })
    game.advance(front.patience + .05)
    const state = game.snapshot()
    return { phase: state.phase, missed: state.shift.missed, streak: state.shift.streak }
  })
  expect(missed).toMatchObject({ phase: 'playing', streak: 0 })
  expect(missed.missed).toBeGreaterThan(0)
  const afterMissPreview = await expectUpcoming(page)
  expect(afterMissPreview).not.toEqual(beforeMissPreview)
  await expect(page.locator('.combo-score')).toHaveText('0/2 +$0')
  await expect(page.locator('.hud-combo')).toHaveClass(/is-break/, { timeout: 500 })
  await expect.poll(async () => includesSequence((await frequencies(page)).slice(breakSoundStart), [330, 247, 185])).toBe(true)

  for (const size of [
    { width: 768, height: 1024, railFirst: true },
    { width: 1440, height: 900, railFirst: false },
  ]) {
    await page.setViewportSize(size)
    await page.waitForTimeout(50)
    const resized = await layout(page)
    expect(resized.allInside).toBe(true)
    expect(resized.clear).toBe(true)
    expect(resized.railBeforeTicket).toBe(size.railFirst)
    expect(resized.ticketBeforeRail).toBe(!size.railFirst)
    expect(resized.rail.bottom).toBeLessThanOrEqual(resized.ticket.bottom)
    expect(resized.panelEndsWithTicket).toBeLessThanOrEqual(1)
  }
})
