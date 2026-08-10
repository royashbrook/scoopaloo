import { expect, test, type Page } from '@playwright/test'
import { depthScale } from '../src/depth'
import { defaultSave } from '../src/engine'
import { SAVE_KEY } from '../src/save'
import type { GameSkin } from '../src/skin'
import skinData from '../src/skins/ice-cream.json' with { type: 'json' }

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

const HELPER_ASSET = '/assets/helpers/pip-prep-pal.svg'
const HELPER = {
  name: 'PIP', image: HELPER_ASSET,
  draw: [678, 622, 64, 78], status: [640, 588, 128, 30],
  prepStation: 'build-station', upgradeId: 'helper',
}
const SEEDED_SAVE = { ...defaultSave(skinData as GameSkin), coins: 199, currentDay: 2 }
type Point = { x: number; y: number }
type WorldBox = { left: number; top: number; right: number; bottom: number }

function sequenceCount(values: number[], sequence: number[]): number {
  return values.reduce((total, _, index) => total
    + Number(sequence.every((value, offset) => values[index + offset] === value)), 0)
}

async function repaint(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

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
  const pickup = await page.evaluate(id => {
    const state = window.__scoopaloo.snapshot()
    const producer = Object.values(state.skin.producers).find(candidate => candidate.item === id)!
    return {
      before: state.player.trayItems[id] ?? 0,
      target: { x: producer.interaction[0], y: producer.interaction[1] },
    }
  }, item)
  await dragTo(page, { x: 480, y: pickup.target.y })
  await dragTo(page, pickup.target)
  await expect.poll(() => page.evaluate(id => window.__scoopaloo.snapshot().player.trayItems[id] ?? 0, item), {
    timeout: 3_000,
  }).toBe(pickup.before + 1)
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().events.some(event => event.kind === 'reject'))).toBe(false)
}

async function finishShift(page: Page): Promise<void> {
  await page.evaluate(() => {
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
        for (let tick = 0; tick < 30 && game.snapshot().phase === 'playing'
          && (game.snapshot().player.trayItems[front.order.item] ?? 0) >= carried; tick++) game.advance(.1)
      }
      game.advance(1)
    }
    for (let tick = 0; tick < 2_000 && game.snapshot().phase === 'playing'; tick++) serveFront()
    if (game.snapshot().phase === 'playing') throw new Error('shift simulation watchdog expired')
  })
  await expect(page.getByRole('heading', { name: 'SHIFT COMPLETE' })).toBeVisible()
}

async function installPipTrace(page: Page): Promise<void> {
  await page.evaluate(asset => {
    type Trace = { draws: number[][]; labels: string[] }
    const target = window as Window & { __pipTrace?: Trace }
    const context = document.querySelector('canvas')!.getContext('2d')!
    const trace: Trace = { draws: [], labels: [] }
    target.__pipTrace = trace
    const drawImage = context.drawImage.bind(context) as (...args: unknown[]) => void
    const fillText = context.fillText.bind(context)
    const clearRect = context.clearRect.bind(context)
    Object.defineProperty(context, 'drawImage', {
      configurable: true,
      value: (...args: unknown[]) => {
        const source = args[0] as { src?: string }
        if (source.src?.endsWith(asset)) trace.draws.push(args.slice(1).map(Number))
        drawImage(...args)
      },
    })
    Object.defineProperty(context, 'fillText', {
      configurable: true,
      value: (text: string, ...args: [number, number, number?]) => {
        if (text.startsWith('PIP ·')) trace.labels.push(text)
        fillText(text, ...args)
      },
    })
    Object.defineProperty(context, 'clearRect', {
      configurable: true,
      value: (x: number, y: number, width: number, height: number) => {
        trace.draws.length = 0
        trace.labels.length = 0
        clearRect(x, y, width, height)
      },
    })
  }, HELPER_ASSET)
}

async function worldHash(page: Page, bounds: WorldBox): Promise<number> {
  return page.evaluate(box => {
    const canvas = document.querySelector('canvas')!
    const view = window.__scoopaloo.viewport()
    const scale = view.scale * view.dpr
    const left = Math.max(0, Math.floor((box.left - view.originX) * scale))
    const top = Math.max(0, Math.floor((box.top - view.originY) * scale))
    const right = Math.min(canvas.width, Math.ceil((box.right - view.originX) * scale))
    const bottom = Math.min(canvas.height, Math.ceil((box.bottom - view.originY) * scale))
    const pixels = canvas.getContext('2d')!.getImageData(left, top, right - left, bottom - top).data
    let hash = 2166136261
    for (const value of pixels) hash = Math.imul(hash ^ value, 16777619)
    return hash >>> 0
  }, bounds)
}

async function captureTransfer(page: Page, reducedMotion: 'no-preference' | 'reduce', path: string): Promise<number> {
  await page.emulateMedia({ reducedMotion })
  await page.reload()
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await page.getByRole('button', { name: 'START RUSH' }).click()
  const bounds = await page.evaluate(() => {
    const game = window.__scoopaloo
    game.advance(.01)
    game.advance(game.snapshot().helper.remaining + .05)
    const state = game.snapshot()
    const event = [...state.events].reverse().find(candidate => candidate.kind === 'prep-start' && candidate.source === 'helper')!
    const recipe = state.skin.items[event.item!].recipe!
    const points = Object.keys(recipe.inputs).map(item => {
      const producer = Object.values(state.skin.producers).find(candidate => candidate.item === item)!
      return { x: producer.interaction[0], y: producer.interaction[1] - 42 }
    })
    const prep = state.skin.prepStations[event.station!].interaction
    points.push({ x: prep[0], y: prep[1] - 54 })
    game.setTime(event.createdAt + .14)
    return {
      left: Math.min(...points.map(point => point.x)) - 50,
      top: Math.min(...points.map(point => point.y)) - 130,
      right: Math.max(...points.map(point => point.x)) + 50,
      bottom: Math.max(...points.map(point => point.y)) + 70,
    }
  })
  await repaint(page)
  await expect(page.locator('[data-field="ticket-guidance"]')).toHaveText('PIP READY · HOLD AT PREP')
  await page.screenshot({ path })
  return worldHash(page, bounds)
}

test('Pip is a phone-first purchase, visible prep timer, and real assisted service strategy', async ({ context, page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => {
    const frequencies: number[] = []
    Object.defineProperty(window, '__pipFrequencies', { configurable: true, value: frequencies })
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
  await page.addInitScript(({ key, save }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(save))
  }, { key: SAVE_KEY, save: SEEDED_SAVE })

  await page.goto('/')
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().skin.helper)).toEqual(HELPER)
  expect(await page.evaluate(() => {
    const save = window.__scoopaloo.snapshot().save
    return { coins: save.coins, currentDay: save.currentDay, helper: save.upgrades.helper }
  })).toEqual({ coins: 199, currentDay: 2, helper: 0 })
  await installPipTrace(page)
  await repaint(page)
  expect(await page.evaluate(() => {
    const target = window as Window & { __pipTrace?: { draws: number[][]; labels: string[] } }
    return { trace: target.__pipTrace, status: document.querySelector('#helper-status')?.textContent }
  })).toEqual({
    trace: { draws: [HELPER.draw], labels: ['PIP · OFF'] },
    status: 'PIP is off. Hire the Prep Pal in the upgrade shop.',
  })
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await finishShift(page)
  await page.getByRole('button', { name: 'UPGRADES' }).click()

  await expect(page.locator('[data-upgrade-card]')).toHaveCount(6)
  const card = page.locator('[data-upgrade-card="helper"]')
  await expect(card).toHaveAttribute('aria-label', 'PIP, Prep Pal, not hired. Stages ingredients for the front order every 30 seconds.')
  await expect(card.getByRole('button')).toHaveAttribute('aria-label', 'Buy PIP level 1 for $180; stages ingredients every 30 seconds')
  await expect(card.locator('img')).toHaveAttribute('alt', '')
  await expect(card.locator('.helper-description')).toHaveText('PIP STAGES INGREDIENTS. YOU FINISH + SERVE.')
  await expect(card.locator('.helper-change small')).toHaveText('STAGES/MIN')
  const shop = await page.evaluate(() => {
    const box = (element: Element) => element.getBoundingClientRect()
    const dialog = document.querySelector<HTMLDialogElement>('.shop-card')!
    const helper = document.querySelector<HTMLElement>('[data-upgrade-card="helper"]')!
    const button = helper.querySelector('button')!
    const description = helper.querySelector<HTMLElement>('.helper-description')!
    const role = helper.querySelector<HTMLElement>('.helper-role')!
    const stat = helper.querySelector<HTMLElement>('.helper-change small')!
    const image = helper.querySelector('img')!
    const bounds = box(dialog)
    const cardBounds = box(helper)
    return {
      dialog: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, height: bounds.height },
      noScroll: dialog.scrollHeight <= dialog.clientHeight + 1 && dialog.scrollWidth <= dialog.clientWidth + 1,
      card: { left: cardBounds.left, right: cardBounds.right, width: cardBounds.width, height: cardBounds.height },
      button: { height: box(button).height, font: parseFloat(getComputedStyle(button).fontSize), fits: button.scrollWidth <= button.clientWidth + 1 },
      description: { font: parseFloat(getComputedStyle(description).fontSize), fits: description.scrollWidth <= description.clientWidth + 1 },
      role: { font: parseFloat(getComputedStyle(role).fontSize), fits: role.scrollWidth <= role.clientWidth + 1 },
      stat: { font: parseFloat(getComputedStyle(stat).fontSize), fits: stat.scrollWidth <= stat.clientWidth + 1 },
      image: { width: box(image).width, height: box(image).height },
    }
  })
  expect(shop.dialog.left).toBeGreaterThanOrEqual(8)
  expect(shop.dialog.right).toBeLessThanOrEqual(382)
  expect(shop.dialog.top).toBeGreaterThanOrEqual(8)
  expect(shop.dialog.bottom).toBeLessThanOrEqual(836)
  expect(shop.dialog.height).toBeLessThanOrEqual(700)
  expect(shop.noScroll).toBe(true)
  expect(shop.card.width).toBeGreaterThanOrEqual(330)
  expect(shop.card.height).toBeGreaterThanOrEqual(92)
  expect(shop.card.height).toBeLessThanOrEqual(100)
  expect(shop.button).toMatchObject({ height: 44, font: 14, fits: true })
  expect(shop.description.font).toBeGreaterThanOrEqual(13)
  expect(shop.description.fits).toBe(true)
  expect(shop.role).toMatchObject({ font: 13, fits: true })
  expect(shop.stat).toMatchObject({ font: 13, fits: true })
  expect(shop.image).toEqual({ width: 48, height: 58 })
  await page.screenshot({ path: 'test-results/helper-phone-shop.png' })

  await page.evaluate(() => navigator.serviceWorker.ready)
  expect(await page.evaluate(async asset => Boolean(await caches.match(asset)), HELPER_ASSET)).toBe(true)
  const asset = await page.evaluate(async src => {
    const response = await fetch(src)
    const svg = await response.text()
    const image = new Image()
    image.src = src
    await image.decode()
    return { ok: response.ok, type: response.headers.get('content-type'), svg, width: image.naturalWidth, height: image.naturalHeight }
  }, HELPER_ASSET)
  expect(asset.ok).toBe(true)
  expect(asset.type).toContain('image/svg+xml')
  expect(asset.svg).not.toMatch(/<text\b|<image\b|(?:xlink:)?href=|url\(/i)
  expect(asset.width).toBeGreaterThan(0)
  expect(asset.height).toBeGreaterThan(0)

  const before = await page.evaluate(() => ({
    coins: window.__scoopaloo.snapshot().save.coins,
    sounds: (window as unknown as { __pipFrequencies: number[] }).__pipFrequencies.length,
  }))
  expect(before.coins).toBeGreaterThanOrEqual(180)
  await card.getByRole('button').click()
  await expect(card).toHaveAttribute('data-level', '1')
  await expect(page.locator('[data-field="purchase-status"]')).toHaveText('PIP hired. Stages ingredients every 30 seconds.')
  const purchase = await page.evaluate(start => ({
    save: window.__scoopaloo.snapshot().save,
    sounds: (window as unknown as { __pipFrequencies: number[] }).__pipFrequencies.slice(start),
  }), before.sounds)
  expect(purchase.save.coins).toBe(before.coins - 180)
  expect(purchase.save.upgrades.helper).toBe(1)
  expect(sequenceCount(purchase.sounds, [660, 880])).toBe(1)

  await page.getByRole('button', { name: 'START SCORE CHASE' }).click()
  await page.reload()
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: /GOAL/ })).toBeVisible()
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().save.upgrades.helper)).toBe(1)
  expect(await page.evaluate(async src => {
    const image = new Image(); image.src = src; await image.decode(); return image.naturalWidth > 0
  }, HELPER_ASSET)).toBe(true)
  await context.setOffline(false)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await page.getByRole('button', { name: 'START RUSH' }).click()
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
  await installPipTrace(page)
  await page.evaluate(() => window.__scoopaloo.advance(.01))
  await repaint(page)

  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1_024 },
    { name: 'desktop', width: 1_440, height: 900 },
  ]) {
    await page.setViewportSize(viewport)
    await repaint(page)
    const layout = await page.evaluate(({ pip, scale }) => {
      const view = window.__scoopaloo.viewport()
      const map = (x: number, y: number) => ({ x: (x - view.originX) * view.scale, y: (y - view.originY) * view.scale })
      const [x, y, width, height] = pip.draw
      const anchor = { x: x + width / 2, y: y + height }
      const grounded = {
        left: anchor.x + (x - anchor.x) * scale,
        top: anchor.y + (y - anchor.y) * scale,
        right: anchor.x + (x + width - anchor.x) * scale,
        bottom: anchor.y + (y + height - anchor.y) * scale,
      }
      const leftTop = map(grounded.left, grounded.top)
      const rightBottom = map(grounded.right, grounded.bottom)
      const ticket = document.querySelector('.order-ticket')!.getBoundingClientRect()
      const target = window as Window & { __pipTrace?: { draws: number[][]; labels: string[] } }
      return {
        sprite: { left: leftTop.x, top: leftTop.y, right: rightBottom.x, bottom: rightBottom.y },
        ticket: { left: ticket.left, top: ticket.top, right: ticket.right, bottom: ticket.bottom },
        trace: target.__pipTrace,
        describedBy: document.querySelector('canvas')!.getAttribute('aria-describedby'),
        status: document.querySelector('#helper-status')!.textContent,
        viewScale: view.scale,
        portrait: innerWidth !== 390 || document.querySelector('canvas')!.getBoundingClientRect().height > innerWidth,
      }
    }, { pip: HELPER, scale: depthScale(700) })
    expect(layout.trace?.draws).toContainEqual(HELPER.draw)
    expect(layout.trace?.labels).toContain('PIP · 30s')
    expect(layout.sprite.left).toBeGreaterThanOrEqual(0)
    expect(layout.sprite.right).toBeLessThanOrEqual(viewport.width)
    if (viewport.width === 390) expect(layout.sprite.bottom).toBeLessThan(layout.ticket.top)
    else expect(layout.sprite.top).toBeGreaterThan(layout.ticket.bottom)
    expect(layout.sprite.bottom).toBeLessThanOrEqual(viewport.height)
    expect(layout.describedBy).toBe('helper-status')
    expect(layout.status).toBe('PIP will be ready in 30 seconds.')
    expect(layout.portrait).toBe(true)
    if (viewport.width === 390) expect(21 * depthScale(700) * layout.viewScale).toBeGreaterThanOrEqual(12)
    await page.screenshot({ path: `test-results/helper-${viewport.name}-countdown.png` })
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => {
    const game = window.__scoopaloo
    const front = game.snapshot().customers.find(customer => !customer.served && !customer.missed)!
    const recipe = game.snapshot().skin.items[front.order.item].recipe!
    for (const [input, quantity] of Object.entries(recipe.inputs)) {
      const producer = Object.values(game.snapshot().skin.producers).find(candidate => candidate.item === input)!
      const target = (game.snapshot().player.trayItems[input] ?? 0) + quantity
      game.movePlayer({ x: producer.interaction[0], y: producer.interaction[1] })
      for (let tick = 0; tick < 100 && (game.snapshot().player.trayItems[input] ?? 0) < target; tick++) game.advance(.2)
    }
    game.advance(game.snapshot().helper.remaining + .05)
  })
  await repaint(page)
  expect(await page.evaluate(() => ({
    remaining: window.__scoopaloo.snapshot().helper.remaining,
    assisted: Object.values(window.__scoopaloo.snapshot().prepStations).some(prep => prep.job?.assisted),
    helperStarts: window.__scoopaloo.snapshot().events.filter(event => event.kind === 'prep-start' && event.source === 'helper').length,
  }))).toEqual({ remaining: 0, assisted: false, helperStarts: 0 })
  await expect(page.locator('#helper-status')).toHaveText('PIP is ready for the next front order.')
  await page.screenshot({ path: 'test-results/helper-phone-ready.png' })
  await page.evaluate(() => {
    const game = window.__scoopaloo
    const front = game.snapshot().customers.find(customer => !customer.served && !customer.missed)!
    const recipe = game.snapshot().skin.items[front.order.item].recipe!
    game.movePlayer({ x: game.snapshot().skin.prepStations[recipe.station].interaction[0], y: game.snapshot().skin.prepStations[recipe.station].interaction[1] })
    game.advance(.1)
  })
  expect(await page.evaluate(() => Object.values(window.__scoopaloo.snapshot().prepStations)
    .find(prep => prep.job)?.job?.assisted ?? false)).toBe(false)

  await page.reload()
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await page.getByRole('button', { name: 'START RUSH' }).click()
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
  const strategy = await page.evaluate(() => {
    const game = window.__scoopaloo
    game.advance(.01)
    const front = game.snapshot().customers.find(customer => !customer.served && !customer.missed)!
    game.advance(2.05)
    const waiting = game.snapshot().customers.filter(customer => !customer.served && !customer.missed)
    const target = waiting[1]
    const recipe = game.snapshot().skin.items[target.order.item].recipe!
    return {
      front: front.id,
      target: target.id,
      item: target.order.item,
      quantity: target.order.quantity,
      price: target.order.price,
      inputs: Object.entries(recipe.inputs).flatMap(([item, count]) => Array(count).fill(item)),
      prep: game.snapshot().skin.prepStations[recipe.station].interaction,
      counter: game.snapshot().skin.stations.counter.interaction,
      initialRemaining: game.snapshot().helper.remaining,
      startCoins: game.snapshot().save.coins,
    }
  })
  expect(strategy).toMatchObject({ item: 'sundae', quantity: 2, price: 26 })
  const laterRow = page.getByLabel('Upcoming orders').locator('li').first()
  await expect(laterRow).toHaveAttribute('data-state', 'actionable')
  await expect(laterRow.locator('.next-state')).toHaveText('NOW')

  await page.evaluate(() => window.__scoopaloo.pause(false))
  for (let made = 0; made < strategy.quantity; made++) {
    for (const input of strategy.inputs) await collectFrom(page, input)
    const beforeProduct = await page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, strategy.item)
    await dragTo(page, { x: 480, y: strategy.prep[1] + 150 })
    await dragTo(page, { x: strategy.prep[0], y: strategy.prep[1] })
    await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, strategy.item), {
      timeout: 6_000,
    }).toBe(beforeProduct + 1)
    await dragTo(page, { x: strategy.counter[0], y: strategy.counter[1] })
    await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, strategy.item), {
      timeout: 3_000,
    }).toBe(beforeProduct)
    expect(await page.evaluate(() => window.__scoopaloo.snapshot().events.some(event => event.kind === 'reject'))).toBe(false)
  }
  await expect.poll(() => page.evaluate(id =>
    window.__scoopaloo.snapshot().customers.find(customer => customer.id === id)?.served ?? false, strategy.target), {
    timeout: 4_000,
  }).toBe(true)
  await page.evaluate(() => window.__scoopaloo.pause(true))

  const later = await page.evaluate(({ frontId, targetId, item, startCoins }) => {
    const state = window.__scoopaloo.snapshot()
    const front = state.customers.find(customer => customer.id === frontId)!
    const target = state.customers.find(customer => customer.id === targetId)!
    const pay = [...state.events].reverse().find(event => event.kind === 'pay' && event.item === item)!
    const expectedTip = Math.ceil(Math.max(0, Math.min(1, target.patience / state.rules.customerPatience)) * 3)
    const expectedCombo = state.skin.comboTiers.reduce((bonus, tier) =>
      (pay.streak ?? 0) >= tier.streak ? tier.bonus : bonus, 0)
    return {
      front: { served: front.served, missed: front.missed },
      target: { served: target.served, price: target.order.price, patience: target.patience },
      helper: { remaining: state.helper.remaining, starts: state.events.filter(event => event.kind === 'prep-start' && event.source === 'helper').length },
      pay: { amount: pay.amount!, tip: pay.tip!, combo: pay.combo!, expectedTip, expectedCombo },
      coins: state.flyingCoins.map(coin => coin.value),
      collected: state.save.coins - startCoins,
      rejects: state.events.filter(event => event.kind === 'reject').map(event => event.reason),
    }
  }, { frontId: strategy.front, targetId: strategy.target, item: strategy.item, startCoins: strategy.startCoins })
  expect(later.front).toEqual({ served: false, missed: false })
  expect(later.target.served).toBe(true)
  expect(later.target.price).toBe(26)
  expect(later.helper.starts).toBe(0)
  expect(later.helper.remaining).toBeGreaterThan(0)
  expect(later.helper.remaining).toBeLessThan(strategy.initialRemaining)
  expect(later.pay).toEqual({ amount: 28, tip: 2, combo: 0, expectedTip: 2, expectedCombo: 0 })
  expect(later.coins).toEqual([7, 7, 7, 7])
  expect(later.collected + later.coins.reduce((sum, value) => sum + value, 0)).toBe(later.pay.amount)
  expect(later.rejects).toEqual([])
  await page.screenshot({ path: 'test-results/helper-phone-later-served.png' })

  const soundStart = await page.evaluate(() => (window as unknown as { __pipFrequencies: number[] }).__pipFrequencies.length)
  const event = await page.evaluate(() => {
    const game = window.__scoopaloo
    game.advance(game.snapshot().helper.remaining + .05)
    const event = [...game.snapshot().events].reverse().find(candidate => candidate.kind === 'prep-start' && candidate.source === 'helper')!
    return { createdAt: event.createdAt, item: event.item!, station: event.station! }
  })
  await page.evaluate(time => window.__scoopaloo.setTime(time), event.createdAt + .14)
  await repaint(page)
  await expect(page.locator('[data-field="ticket-guidance"]')).toHaveText('PIP READY · HOLD AT PREP')
  const assistedTicket = await page.evaluate(() => {
    const ticket = document.querySelector('.order-ticket')!.getBoundingClientRect()
    const guidance = document.querySelector<HTMLElement>('[data-field="ticket-guidance"]')!
    return { height: ticket.height, fits: guidance.scrollWidth <= guidance.clientWidth, font: parseFloat(getComputedStyle(guidance).fontSize) }
  })
  expect(assistedTicket.height).toBe(132)
  expect(assistedTicket).toMatchObject({ fits: true, font: 15 })
  const assisted = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const job = state.prepStations[Object.keys(state.prepStations)[0]].job
    return { assisted: job?.assisted, remaining: state.helper.remaining, playerItem: state.player.trayItems[job?.item ?? ''] ?? 0 }
  })
  expect(assisted).toMatchObject({ assisted: true, playerItem: 0 })
  expect(assisted.remaining).toBeGreaterThan(29.8)
  expect(assisted.remaining).toBeLessThanOrEqual(30)
  const helperSounds = await page.evaluate(start =>
    (window as unknown as { __pipFrequencies: number[] }).__pipFrequencies.slice(start), soundStart)
  expect(sequenceCount(helperSounds, [440, 560])).toBe(1)
  await page.evaluate(() => window.__scoopaloo.pause(false))
  const route = await page.evaluate(({ item, station }) => ({
    prep: window.__scoopaloo.snapshot().skin.prepStations[station].interaction,
    counter: window.__scoopaloo.snapshot().skin.stations.counter.interaction,
    item,
    label: window.__scoopaloo.snapshot().skin.items[item].label,
    front: window.__scoopaloo.snapshot().customers.find(customer => !customer.served && !customer.missed)!.id,
  }), event)
  await dragTo(page, { x: route.prep[0], y: route.prep[1] })
  await page.waitForTimeout(80)
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await repaint(page)
  await expect(page.locator('[data-field="ticket-guidance"]')).toHaveText(`MAKING ${route.label}`)
  await page.evaluate(() => window.__scoopaloo.pause(false))
  await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, route.item), { timeout: 6_000 }).toBe(1)
  await dragTo(page, { x: route.counter[0], y: route.counter[1] })
  await expect.poll(() => page.evaluate(id =>
    window.__scoopaloo.snapshot().customers.find(customer => customer.id === id)?.served ?? false, route.front), { timeout: 4_000 }).toBe(true)
  expect(await page.evaluate(() => ({
    served: window.__scoopaloo.snapshot().shift.served,
    wrong: window.__scoopaloo.snapshot().events.some(candidate => candidate.kind === 'reject' && candidate.reason === 'wrong-item'),
  }))).toEqual({ served: 2, wrong: false })
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await page.screenshot({ path: 'test-results/helper-phone-cooldown.png' })

  const normalHash = await captureTransfer(page, 'no-preference', 'test-results/helper-phone-deliver.png')
  const reducedHash = await captureTransfer(page, 'reduce', 'test-results/helper-phone-deliver-reduced.png')
  expect(reducedHash).not.toBe(normalHash)
})
