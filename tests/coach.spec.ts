import { expect, test, type Page } from '@playwright/test'
import { defaultSave } from '../src/engine'
import { SAVE_KEY } from '../src/save'
import type { GameSkin } from '../src/skin'
import skinData from '../src/skins/ice-cream.json' with { type: 'json' }

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })

const READY_COPY = 'DRAG TO MOVE · WALK INTO DASHED RINGS TO PICK UP'
const MOVE_COPY = 'DRAG ANYWHERE TO MOVE'
const RING_COPY = 'WALK INTO VANILLA RING'
const CANVAS_LABEL = 'Scoopaloo ice cream stand game. Drag anywhere to move, or use W A S D or arrow keys. Walk into dashed ingredient rings to pick up ingredients automatically. Hold at prep until complete.'
const DEFAULT_SAVE = defaultSave(skinData as GameSkin)
const PROGRESSED_SAVES = [
  { name: 'lifetime cash', save: { ...DEFAULT_SAVE, lifetimeCash: 1 } },
  { name: 'Day 1 record', save: { ...DEFAULT_SAVE, dayBestRevenue: [1, 0, 0] as [number, number, number] } },
]
type Point = { x: number; y: number }

function sequenceCount(values: number[], sequence: number[]): number {
  return values.reduce((total, _, index) => total
    + Number(sequence.every((value, offset) => values[index + offset] === value)), 0)
}

async function frequencies(page: Page): Promise<number[]> {
  return page.evaluate(() => [...(window as unknown as { __coachFrequencies: number[] }).__coachFrequencies])
}

async function repaint(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function crossMovementThreshold(page: Page): Promise<void> {
  const guidance = page.locator('[data-field="ticket-guidance"]')
  const start = await page.evaluate(() => {
    const { x, y } = window.__scoopaloo.snapshot().player
    return { x, y }
  })
  await page.mouse.move(195, 700)
  await page.mouse.down()
  await page.mouse.move(199, 700)
  await expect.poll(() => page.evaluate(origin => {
    const player = window.__scoopaloo.snapshot().player
    return Math.hypot(player.x - origin.x, player.y - origin.y)
  }, start)).toBeGreaterThanOrEqual(12)
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await page.mouse.up()
  const belowThreshold = await page.evaluate(origin => {
    const player = window.__scoopaloo.snapshot().player
    return Math.hypot(player.x - origin.x, player.y - origin.y)
  }, start)
  expect(belowThreshold).toBeLessThan(24)
  await expect(guidance).toHaveText(MOVE_COPY)
  await page.evaluate(() => window.__scoopaloo.pause(false))
  await page.mouse.move(195, 700)
  await page.mouse.down()
  await page.mouse.move(199, 700)
  await expect.poll(() => page.evaluate(origin => {
    const player = window.__scoopaloo.snapshot().player
    return Math.hypot(player.x - origin.x, player.y - origin.y)
  }, start)).toBeGreaterThanOrEqual(24)
  await expect(guidance).toHaveText(RING_COPY)
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

async function neededProducer(page: Page): Promise<{ id: string; item: string; point: Point }> {
  return page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const front = state.customers.find(customer => !customer.served && !customer.missed)!
    const inputs = Object.keys(state.skin.items[front.order.item].recipe!.inputs)
    const candidates = Object.entries(state.skin.producers)
      .filter(([id, producer]) => id in state.sources && inputs.includes(producer.item))
      .map(([id, producer]) => ({
        id,
        item: producer.item,
        point: { x: producer.interaction[0], y: producer.interaction[1] },
        distance: Math.hypot(producer.interaction[0] - state.player.x, producer.interaction[1] - state.player.y),
      }))
    const closest = candidates.sort((a, b) => a.distance - b.distance)[0]
    if (!closest) throw new Error('needed producer missing')
    return { id: closest.id, item: closest.item, point: closest.point }
  })
}

async function collect(page: Page, producer: { id: string; item: string; point: Point }): Promise<void> {
  await expect.poll(() => page.evaluate(id => window.__scoopaloo.snapshot().sources[id]?.stock ?? 0, producer.id)).toBeGreaterThan(0)
  await dragTo(page, producer.point)
  await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, producer.item)).toBe(1)
}

async function expectReadyFits(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('.ready-card')!
    const banner = document.querySelector<HTMLElement>('[data-field="ready-unlock"]')!
    const box = (element: Element) => element.getBoundingClientRect()
    return {
      card: box(card).toJSON(),
      banner: box(banner).toJSON(),
      cardFits: card.scrollWidth <= card.clientWidth + 1 && card.scrollHeight <= card.clientHeight + 1,
      bannerFits: banner.scrollWidth <= banner.clientWidth + 1 && banner.scrollHeight <= banner.clientHeight + 1,
      font: parseFloat(getComputedStyle(banner).fontSize),
    }
  })
  expect(layout.card.left).toBeGreaterThanOrEqual(16)
  expect(layout.card.right).toBeLessThanOrEqual(374)
  expect(layout.card.top).toBeGreaterThanOrEqual(16)
  expect(layout.card.bottom).toBeLessThanOrEqual(828)
  expect(layout.card.height).toBeLessThanOrEqual(340)
  expect(layout.banner.height).toBeLessThanOrEqual(51)
  expect(layout.cardFits).toBe(true)
  expect(layout.bannerFits).toBe(true)
  expect(layout.font).toBeGreaterThanOrEqual(13)
}

async function expectPlayingFits(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
    const panel = box('.order-panel')
    const ticket = box('.order-ticket')
    const rail = box('.next-orders')
    const guidance = document.querySelector<HTMLElement>('[data-field="ticket-guidance"]')!
    const guidanceBox = box('.ticket-guidance')
    const first = ticket.left < rail.left ? ticket : rail
    const second = ticket.left < rail.left ? rail : ticket
    return {
      panel: panel.toJSON(),
      ticket: ticket.toJSON(),
      rail: rail.toJSON(),
      gap: second.left - first.right,
      guidance: guidanceBox.toJSON(),
      guidanceFits: guidance.scrollWidth <= guidance.clientWidth + 1 && guidance.scrollHeight <= guidance.clientHeight + 1,
      guidanceFont: parseFloat(getComputedStyle(guidance).fontSize),
      width: innerWidth,
      height: innerHeight,
    }
  })
  const expectedPanel = layout.width < 600 ? layout.width - 24 : 298
  expect(layout.panel.width).toBe(expectedPanel)
  expect(layout.ticket.width).toBe(expectedPanel - 68)
  expect(layout.rail.width).toBe(60)
  expect(layout.gap).toBe(8)
  expect(layout.ticket.height).toBeLessThanOrEqual(244)
  expect(layout.guidance.height).toBeGreaterThanOrEqual(32)
  expect(layout.guidanceFits).toBe(true)
  expect(layout.guidanceFont).toBeGreaterThanOrEqual(13)
  for (const item of [layout.panel, layout.ticket, layout.rail, layout.guidance]) {
    expect(item.left).toBeGreaterThanOrEqual(0)
    expect(item.top).toBeGreaterThanOrEqual(0)
    expect(item.right).toBeLessThanOrEqual(layout.width)
    expect(item.bottom).toBeLessThanOrEqual(layout.height)
  }
}

test('teaches one real first-shift drag and ring pickup without touching the save', async ({ context, page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => {
    const heard: number[] = []
    Object.defineProperty(window, '__coachFrequencies', { configurable: true, value: heard })
    class Param {
      constructor(private readonly record = false) {}
      setValueAtTime(value: number) { if (this.record) heard.push(value); return this }
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
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
  const saveBefore = await page.evaluate(() => JSON.stringify(window.__scoopaloo.snapshot().save))
  await expect(page.locator('[data-field="ready-unlock"]')).toHaveText(READY_COPY)
  await expect(page.locator('#game')).toHaveAttribute('aria-label', CANVAS_LABEL)
  await expect(page.locator('.order-panel button')).toHaveCount(0)
  await expectReadyFits(page)
  await page.screenshot({ path: 'test-results/coach-phone-ready.png' })

  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await page.evaluate(() => { window.__scoopaloo.pause(true); window.__scoopaloo.setTime(4.26) })
  const guidance = page.locator('[data-field="ticket-guidance"]')
  await expect(guidance).toHaveText(MOVE_COPY)
  await expect(guidance).toHaveAttribute('role', 'status')
  await expect(guidance).toHaveAttribute('aria-live', 'polite')
  await expect(guidance).toHaveAttribute('aria-atomic', 'true')
  expect(sequenceCount(await frequencies(page), [330, 440, 660])).toBe(1)
  await expectPlayingFits(page)
  await page.screenshot({ path: 'test-results/coach-phone-move.png' })

  const warning = await page.evaluate(() => {
    const game = window.__scoopaloo
    const origin = { x: game.snapshot().player.x, y: game.snapshot().player.y }
    const state = game.snapshot()
    const front = state.customers.find(customer => !customer.served && !customer.missed)!
    const input = Object.keys(state.skin.items[front.order.item].recipe!.inputs)[0]
    const [, source] = Object.entries(state.skin.producers)
      .find(([id, producer]) => id in state.sources && producer.item === input)!
    game.movePlayer({ x: source.interaction[0], y: source.interaction[1] })
    for (let tick = 0; tick < 40 && (game.snapshot().player.trayItems[input] ?? 0) === 0; tick++) game.advance(.1)
    const [x, y] = game.snapshot().skin.stations.counter.interaction
    game.movePlayer({ x, y })
    for (let tick = 0; tick < 20 && !game.snapshot().events.some(event => event.kind === 'reject'); tick++) game.advance(.05)
    game.movePlayer(origin)
    const after = game.snapshot()
    return {
      distance: Math.hypot(after.player.x - origin.x, after.player.y - origin.y),
      reason: after.events.find(event => event.kind === 'reject')?.reason,
    }
  })
  expect(warning).toMatchObject({ distance: 0, reason: 'needs-prep' })
  await expect(guidance).toHaveText('FINISH IT AT PREP')
  await page.screenshot({ path: 'test-results/coach-phone-warning.png' })
  await page.evaluate(() => window.__scoopaloo.advance(window.__scoopaloo.snapshot().shift.remaining))
  await expect(page.getByRole('heading', { name: 'GOAL MISSED' })).toBeVisible()
  await page.getByRole('button', { name: 'RETRY' }).click()
  await expect(guidance).toHaveText(MOVE_COPY)
  expect(sequenceCount(await frequencies(page), [330, 440, 660])).toBe(2)

  await page.evaluate(() => window.__scoopaloo.pause(false))
  await page.mouse.click(195, 700)
  await page.waitForTimeout(100)
  await expect(guidance).toHaveText(MOVE_COPY)
  await crossMovementThreshold(page)
  await page.evaluate(() => { window.__scoopaloo.pause(true); window.__scoopaloo.setTime(4.26) })
  await page.mouse.move(253, 700)
  expect(await page.evaluate(() => window.__scoopaloo.joystickOrigin())).not.toBeNull()
  await page.screenshot({ path: 'test-results/coach-phone-drag.png' })
  await page.mouse.up()
  await page.evaluate(() => window.__scoopaloo.pause(false))
  await page.waitForTimeout(60)
  await page.evaluate(() => { window.__scoopaloo.pause(true); window.__scoopaloo.setTime(4.26) })

  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await repaint(page)
    await expect(guidance).toHaveText(RING_COPY)
    await expectPlayingFits(page)
    await page.screenshot({ path: `test-results/coach-${viewport.name}-ring.png` })
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.__scoopaloo.pause(false))
  const producer = await neededProducer(page)
  const pickupSounds = sequenceCount(await frequencies(page), [760])
  await collect(page, producer)
  await expect(guidance).not.toHaveText(RING_COPY)
  expect(sequenceCount(await frequencies(page), [760])).toBe(pickupSounds + 1)
  await expect(page.locator('[data-inventory="tray"]')).toContainText('×1')
  await dragTo(page, { x: 480, y: 880 })
  await page.evaluate(() => { window.__scoopaloo.pause(true); window.__scoopaloo.setTime(4.26) })
  await page.screenshot({ path: 'test-results/coach-phone-picked-up.png' })

  await page.evaluate(() => window.__scoopaloo.advance(window.__scoopaloo.snapshot().shift.remaining))
  await expect(page.getByRole('heading', { name: 'GOAL MISSED' })).toBeVisible()
  const startsBeforeMute = sequenceCount(await frequencies(page), [330, 440, 660])
  const soundButton = page.locator('#sound-button')
  await soundButton.click()
  await expect(soundButton).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'RETRY' }).click()
  await expect(guidance).toHaveText('GET VANILLA + CONE')
  expect(sequenceCount(await frequencies(page), [330, 440, 660])).toBe(startsBeforeMute)

  const mutedPickupSounds = sequenceCount(await frequencies(page), [760])
  await page.evaluate(() => window.__scoopaloo.pause(false))
  await collect(page, await neededProducer(page))
  expect(sequenceCount(await frequencies(page), [760])).toBe(mutedPickupSounds)
  expect(await page.evaluate(() => JSON.stringify(window.__scoopaloo.snapshot().save))).toBe(saveBefore)
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /coach|tutorial/i.test(key)))).toEqual([])
  expect(await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('scoopaloo_save_v1') ?? '{}') as Record<string, unknown>
    return Object.keys(saved).filter(key => /coach|tutorial/i.test(key))
  })).toEqual([])

  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.locator('[data-field="ready-unlock"]')).toHaveText(READY_COPY)
  await context.setOffline(true)
  try {
    await page.reload()
    await expect(page.locator('[data-field="ready-unlock"]')).toHaveText(READY_COPY)
    await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'false')
    await page.screenshot({ path: 'test-results/coach-phone-offline-ready.png' })
    await page.getByRole('button', { name: 'START SHIFT' }).click()
    await expect(page.locator('[data-field="ticket-guidance"]')).toHaveText(MOVE_COPY)
    await crossMovementThreshold(page)
    await page.mouse.up()
    await collect(page, await neededProducer(page))
    await expect(page.locator('[data-field="ticket-guidance"]')).not.toHaveText(RING_COPY)
    expect(sequenceCount(await frequencies(page), [760])).toBe(0)
    expect(await page.evaluate(() => JSON.stringify(window.__scoopaloo.snapshot().save))).toBe(saveBefore)
    await dragTo(page, { x: 480, y: 880 })
    await page.evaluate(() => { window.__scoopaloo.pause(true); window.__scoopaloo.setTime(4.26) })
    await page.screenshot({ path: 'test-results/coach-phone-offline-picked-up.png' })
  } finally {
    await context.setOffline(false)
  }
})

test('keeps the movement lesson learned on the shift-ending frame', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  const guidance = page.locator('[data-field="ticket-guidance"]')
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(true)
    const state = game.snapshot()
    game.movePlayer({ x: state.player.x + 23, y: state.player.y })
    game.advance(state.shift.remaining - .03)
  })
  await expect(guidance).toHaveText(MOVE_COPY)

  await page.mouse.move(195, 700)
  await page.mouse.down()
  try {
    await page.mouse.move(253, 700)
    await page.evaluate(() => window.__scoopaloo.pause(false))
    await expect(page.getByRole('heading', { name: 'GOAL MISSED' })).toBeVisible()
  } finally {
    await page.mouse.up()
  }
  await page.getByRole('button', { name: 'RETRY' }).click()
  await expect(guidance).toHaveText(RING_COPY)
})

for (const progress of PROGRESSED_SAVES) {
  test(`existing ${progress.name} suppresses the coach`, async ({ page }) => {
    await page.addInitScript(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
      key: SAVE_KEY,
      save: progress.save,
    })
    await page.goto('/')
    await expect(page.locator('[data-field="ready-unlock"]')).toBeHidden()
    await page.getByRole('button', { name: 'START SHIFT' }).click()
    await page.evaluate(() => window.__scoopaloo.pause(true))
    await expect(page.locator('[data-field="ticket-guidance"]')).toHaveText('GET VANILLA + CONE')
  })
}
