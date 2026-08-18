import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'no-preference' })

async function useDayTwo(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('scoopaloo_save_v1', JSON.stringify({ version: 1, currentDay: 1 })))
}

async function serveFront(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = window.__scoopaloo
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const front = game.snapshot().customers.find(customer => !customer.served && !customer.missed)
    if (!front) throw new Error('no customer to serve')
    const servedBefore = game.snapshot().shift.served
    const recipe = game.snapshot().skin.items[front.order.item].recipe!
    for (let made = 0; made < front.order.quantity; made++) {
      for (const [input, quantity] of Object.entries(recipe.inputs)) {
        const state = game.snapshot()
        const producer = Object.values(state.skin.producers).find(candidate => candidate.item === input)!
        const target = (state.player.trayItems[input] ?? 0) + quantity
        game.movePlayer(point(producer.interaction))
        for (let tick = 0; tick < 100 && (game.snapshot().player.trayItems[input] ?? 0) < target; tick++) game.advance(.2)
      }
      const before = game.snapshot().player.trayItems[front.order.item] ?? 0
      game.movePlayer(point(game.snapshot().skin.prepStations[recipe.station].interaction))
      for (let tick = 0; tick < 100 && (game.snapshot().player.trayItems[front.order.item] ?? 0) <= before; tick++) game.advance(.2)
      const carried = game.snapshot().player.trayItems[front.order.item] ?? 0
      game.movePlayer(point(game.snapshot().skin.stations.counter.interaction))
      for (let tick = 0; tick < 30 && (game.snapshot().player.trayItems[front.order.item] ?? 0) >= carried; tick++) game.advance(.1)
    }
    for (let tick = 0; tick < 30 && game.snapshot().shift.served === servedBefore; tick++) game.advance(.05)
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
    const hud = box('.shift-hud')
    const save = box('#save-button')
    const sound = box('#sound-button')
    const inside = (rect: ReturnType<typeof box>) => rect.left >= 0 && rect.top >= 0
      && rect.right <= innerWidth && rect.bottom <= innerHeight
    const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const sized = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)!
      return {
        font: parseFloat(getComputedStyle(element).fontSize),
        fits: element.scrollWidth <= element.clientWidth,
      }
    }
    return {
      panel, ticket, rail,
      allInside: [panel, ticket, rail, hud, save, sound].every(inside),
      clear: !overlaps(ticket, rail) && !overlaps(panel, hud) && !overlaps(panel, save) && !overlaps(panel, sound),
      railBeforeTicket: rail.right <= ticket.left,
      ticketBeforeRail: ticket.right <= rail.left,
      gap: rail.right <= ticket.left ? ticket.left - rail.right : rail.left - ticket.right,
      panelEndsWithTicket: Math.abs(panel.bottom - ticket.bottom),
      payout: sized('[data-field="order-payout"]'),
      seconds: sized('[data-field="patience-seconds"]'),
      tip: sized('[data-field="tip-value"]'),
      combo: sized('[data-field="projected-combo"]'),
      nextSeconds: sized('.next-seconds:not([hidden])'),
    }
  })
}

test('shows live maximum stakes, waiting clocks, and one accessible hurry cue', async ({ page }) => {
  test.setTimeout(30_000)
  await useDayTwo(page)
  await page.addInitScript(() => {
    const frequencies: number[] = []
    Object.defineProperty(window, '__stakesFrequencies', { value: frequencies })
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
    window.__scoopaloo.advance(5.05)
  })

  const ticket = page.getByLabel('Current order')
  const patience = page.getByRole('progressbar', { name: 'Customer patience' })
  await expect(ticket).toContainText('MAX $15')
  await expect(ticket).toContainText('27s')
  await expect(ticket).toContainText('TIP +$3')
  await expect(ticket).toContainText('COMBO +$0')
  await expect(patience).toHaveAttribute('aria-valuemax', '32')
  await expect(patience).toHaveAttribute('aria-valuetext', '27 seconds remaining. Maximum payout $15 at current patience: $12 order, up to $3 tip, up to $0 combo.')
  const nextSeconds = await page.evaluate(() => Math.ceil(window.__scoopaloo.snapshot().customers
    .filter(customer => !customer.served && !customer.missed)[1].patience))
  await expect(page.locator('.next-seconds:not([hidden])')).toHaveText(`${nextSeconds}s`)
  await expect(page.getByLabel('Upcoming orders').locator('li').first()).toHaveAttribute('aria-label', new RegExp(`${nextSeconds} seconds remaining`))
  await expect(page.getByLabel('Upcoming orders').locator('li').nth(1)).toHaveAttribute('aria-label', /not waiting yet/)

  for (const size of [
    { name: 'phone', width: 390, height: 844, railFirst: true },
    { name: 'tablet', width: 768, height: 1024, railFirst: true },
    { name: 'desktop', width: 1440, height: 900, railFirst: false },
  ]) {
    await page.setViewportSize(size)
    const view = await layout(page)
    expect(view.allInside, size.name).toBe(true)
    expect(view.clear, size.name).toBe(true)
    const phone = size.width < 600
    const expectedPanel = phone ? size.width - 24 : 298
    expect(view.panel.width, size.name).toBeCloseTo(expectedPanel, 0)
    expect(view.ticket.width, size.name).toBeCloseTo(phone ? 308 : expectedPanel - 68, 0)
    expect(view.rail.width, size.name).toBeCloseTo(phone ? 52 : 60, 0)
    expect(view.gap, size.name).toBeCloseTo(phone ? 6 : 8, 0)
    if (phone) expect(view.ticket.height, size.name).toBe(132)
    else expect(view.ticket.height, size.name).toBeLessThanOrEqual(244)
    expect(view.railBeforeTicket, size.name).toBe(size.railFirst)
    expect(view.ticketBeforeRail, size.name).toBe(!size.railFirst)
    expect(view.panelEndsWithTicket, size.name).toBeLessThanOrEqual(1)
    expect([view.seconds, view.tip, view.combo, view.nextSeconds].every(value => value.font >= 12), size.name).toBe(true)
    expect(view.payout.font, size.name).toBeGreaterThanOrEqual(13)
    expect([view.payout, view.seconds, view.tip, view.combo, view.nextSeconds].every(value => value.fits), size.name).toBe(true)
    await page.screenshot({ path: `test-results/stakes-${size.name}-live.png` })
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.__scoopaloo.advance(10.1))
  await expect(ticket).toContainText('17s')
  await expect(ticket).toContainText('TIP +$2')
  await expect(ticket).toContainText('MAX $14')

  await serveFront(page)
  await expect(ticket).toContainText('COMBO +$2')
  const projected = await ticket.evaluate(element => ({
    price: Number(element.querySelector('[data-field="order-price"]')!.textContent!.replace(/\D/g, '')),
    tip: Number(element.querySelector('[data-field="tip-value"]')!.textContent!.replace(/\D/g, '')),
    combo: Number(element.querySelector('[data-field="projected-combo"]')!.textContent!.replace(/\D/g, '')),
    payout: Number(element.querySelector('[data-field="order-payout"]')!.textContent!.replace(/\D/g, '')),
  }))
  expect(projected.payout).toBe(projected.price + projected.tip + projected.combo)
  await page.screenshot({ path: 'test-results/stakes-phone-combo-ready.png' })

  const soundStart = await page.evaluate(() => (window as unknown as { __stakesFrequencies: number[] }).__stakesFrequencies.length)
  await page.evaluate(() => {
    const game = window.__scoopaloo
    const front = game.snapshot().customers.find(customer => !customer.served && !customer.missed)!
    game.movePlayer({ x: 55, y: 1150 })
    game.advance(Math.max(0, front.patience - 9.4))
  })
  await expect(ticket).toHaveClass(/is-urgent/)
  await expect(ticket).toContainText('10s')
  await expect(patience).toHaveAttribute('aria-valuenow', '10')
  await expect(patience).toHaveAttribute('aria-valuetext', /10 seconds remaining\. Maximum payout \$\d+ at current patience:/)
  await expect(page.locator('[data-field="urgent-status"]')).toContainText(/Hurry: 10 seconds left.*Maximum payout is now \$\d+/)
  await expect.poll(() => page.evaluate(start =>
    (window as unknown as { __stakesFrequencies: number[] }).__stakesFrequencies.slice(start).filter(value => value === 784).length,
  soundStart)).toBe(2)
  await page.evaluate(() => window.__scoopaloo.advance(1))
  await page.waitForTimeout(50)
  expect(await page.evaluate(start =>
    (window as unknown as { __stakesFrequencies: number[] }).__stakesFrequencies.slice(start).filter(value => value === 784).length,
  soundStart)).toBe(2)
  await page.screenshot({ path: 'test-results/stakes-phone-urgent.png' })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(ticket).toHaveCSS('animation-name', 'none')
})

test('keeps the displayed maximum honest across the service-delay tip boundary', async ({ page }) => {
  await useDayTwo(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await page.evaluate(() => {
    const game = window.__scoopaloo
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    game.pause(true)
    const front = game.snapshot().customers.find(customer => !customer.served && !customer.missed)!
    const recipe = game.snapshot().skin.items[front.order.item].recipe!
    for (const [input, quantity] of Object.entries(recipe.inputs)) {
      const state = game.snapshot()
      const producer = Object.values(state.skin.producers).find(candidate => candidate.item === input)!
      const target = (state.player.trayItems[input] ?? 0) + quantity
      game.movePlayer(point(producer.interaction))
      for (let tick = 0; tick < 100 && (game.snapshot().player.trayItems[input] ?? 0) < target; tick++) game.advance(.2)
    }
    game.movePlayer(point(game.snapshot().skin.prepStations[recipe.station].interaction))
    for (let tick = 0; tick < 100 && (game.snapshot().player.trayItems[front.order.item] ?? 0) === 0; tick++) game.advance(.2)

    game.movePlayer({ x: 55, y: 1150 })
    const remaining = game.snapshot().customers.find(customer => !customer.served && !customer.missed)!.patience
    game.advance(Math.max(0, remaining - (game.snapshot().rules.customerPatience / 3 + .05)))
  })

  const ticket = page.getByLabel('Current order')
  await expect(ticket).toContainText('MAX $14')
  await expect(ticket).toContainText('TIP +$2')
  const displayedMaximum = Number((await ticket.locator('[data-field="order-payout"]').textContent())?.replace(/\D/g, ''))

  await page.evaluate(() => {
    const game = window.__scoopaloo
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const front = game.snapshot().customers.find(customer => !customer.served && !customer.missed)!
    const carried = game.snapshot().player.trayItems[front.order.item] ?? 0
    game.movePlayer(point(game.snapshot().skin.stations.counter.interaction))
    for (let tick = 0; tick < 20 && (game.snapshot().player.trayItems[front.order.item] ?? 0) >= carried; tick++) game.advance(.05)
  })

  const paid = await page.evaluate(() => {
    window.__scoopaloo.advance(.7)
    const event = [...window.__scoopaloo.snapshot().events].reverse().find(candidate => candidate.kind === 'pay')
    if (!event?.amount) throw new Error('service delay produced no payment')
    return { amount: event.amount, tip: event.tip, combo: event.combo }
  })

  expect(paid).toEqual({ amount: 13, tip: 1, combo: 0 })
  expect(paid.amount).toBeLessThan(displayedMaximum)
})
