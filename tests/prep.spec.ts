import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })

type Point = { x: number; y: number }

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
        const distance = Math.hypot(dx, dy)
        return { dx, dy, distance, phase: state.phase }
      }, target)
      if (next.distance < 52) return
      if (next.phase !== 'playing') throw new Error(`shift ended ${Math.round(next.distance)} units before target`)
      await page.mouse.move(
        origin.x + next.dx / next.distance * 58,
        origin.y + next.dy / next.distance * 58,
      )
      await page.waitForTimeout(35)
    }
    throw new Error(`pointer route did not reach ${target.x},${target.y}`)
  } finally {
    await page.mouse.up()
  }
}

async function producerFor(page: Page, item: string): Promise<Point> {
  return page.evaluate(id => {
    const producer = Object.values(window.__scoopaloo.snapshot().skin.producers)
      .find(candidate => candidate.item === id)
    if (!producer) throw new Error(`producer missing for ${id}`)
    return { x: producer.interaction[0], y: producer.interaction[1] }
  }, item)
}

async function collectFrom(page: Page, item: string): Promise<void> {
  const target = await producerFor(page, item)
  // The flavor row sits behind the vessel row. Approach through the center
  // aisle so this pointer proof chooses one ingredient instead of collecting
  // a vessel during a diagonal drive-by.
  if (target.y > 1000) await dragTo(page, { x: 480, y: target.y })
  await dragTo(page, target)
}

test('one thumb builds two components, rejects raw stock, then recovers and serves', async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    const frequencies: number[] = []
    Object.defineProperty(window, '__prepFrequencies', { value: frequencies })
    class Param {
      constructor(private readonly records = false) {}
      setValueAtTime(value: number) { if (this.records) frequencies.push(value); return this }
      exponentialRampToValueAtTime() { return this }
    }
    class TestAudioContext {
      currentTime = 0
      state = 'suspended'
      destination = {}
      resume() { this.state = 'running'; return Promise.resolve() }
      createOscillator() {
        return {
          type: 'sine', frequency: new Param(true), connect: () => {},
          start: () => {}, stop: () => {},
        }
      }
      createGain() { return { gain: new Param(), connect: () => {} } }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: TestAudioContext })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'START SHIFT' }).click()

  const route = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const front = state.customers.find(customer => !customer.served && !customer.missed)!
    const recipe = state.skin.items[front.order.item].recipe!
    const inputs = Object.keys(recipe.inputs)
    const prep = state.skin.prepStations[recipe.station].interaction
    const counter = state.skin.stations.counter.interaction
    return {
      item: front.order.item,
      label: front.order.label,
      inputs,
      prep: { x: prep[0], y: prep[1] },
      counter: { x: counter[0], y: counter[1] },
    }
  })
  expect(route.inputs).toHaveLength(2)

  const first = route.inputs[0]
  await collectFrom(page, first)
  await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, first)).toBe(1)
  await expect.poll(() => page.evaluate(() =>
    Object.values(window.__scoopaloo.snapshot().player.trayItems).reduce((sum, count) => sum + count, 0),
  )).toBe(1)
  await expect(page.locator('.recipe-list li')).toHaveCount(2)
  await expect(page.locator('.recipe-list')).toContainText('1/1')
  await expect(page.locator('.recipe-list [aria-current="step"]')).toHaveCount(1)

  await dragTo(page, route.counter)
  await expect.poll(() => page.evaluate(() =>
    window.__scoopaloo.snapshot().events.some(event => event.kind === 'reject' && event.reason === 'needs-prep'),
  )).toBe(true)
  const rejected = await page.evaluate(item => {
    const state = window.__scoopaloo.snapshot()
    return { tray: state.player.trayItems[item] ?? 0, counter: state.counter.items[item] ?? 0 }
  }, first)
  expect(rejected).toEqual({ tray: 1, counter: 0 })
  await expect(page.locator('.order-ticket')).toHaveClass(/is-wrong/)
  await expect(page.locator('[data-field="ticket-guidance"]')).toContainText(/PREP|BUILD|FINISH/)

  await collectFrom(page, first)
  await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, first)).toBe(2)
  await dragTo(page, route.counter)
  await expect.poll(() => page.evaluate(() =>
    window.__scoopaloo.snapshot().events.some(event => event.kind === 'reject' && event.reason === 'returned-raw'),
  )).toBe(true)
  const returned = await page.evaluate(item => {
    const state = window.__scoopaloo.snapshot()
    return {
      item: state.player.trayItems[item] ?? 0,
      total: Object.values(state.player.trayItems).reduce((sum, count) => sum + count, 0),
      counter: state.counter.items[item] ?? 0,
    }
  }, first)
  expect(returned).toEqual({ item: 1, total: 1, counter: 0 })
  await expect(page.locator('[data-field="ticket-guidance"]')).toContainText(/RETURN|EXTRA|SPACE/)

  const second = route.inputs[1]
  await collectFrom(page, second)
  await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, second)).toBe(1)
  await expect(page.locator('.recipe-list li')).toHaveCount(2)
  await expect(page.locator('.recipe-list li.is-done')).toHaveCount(2)

  await dragTo(page, route.prep)
  await expect.poll(() => page.evaluate(() =>
    Object.values(window.__scoopaloo.snapshot().prepStations).some(station => station.job !== null),
  )).toBe(true)
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await expect(page.locator('[data-field="prep-progress"]')).toBeVisible()
  const progress = Number(await page.locator('[data-field="prep-progress"]').getAttribute('aria-valuenow'))
  expect(progress).toBeGreaterThanOrEqual(0)
  expect(progress).toBeLessThan(100)
  await page.screenshot({ path: 'test-results/prep-phone-progress.png' })
  await page.evaluate(() => window.__scoopaloo.pause(false))

  await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, route.item), {
    timeout: 3_000,
  }).toBe(1)
  await expect(page.locator('[data-field="ticket-guidance"]')).toContainText(/COUNTER|DELIVER|SERVE/)
  await expect(page.locator('.recipe-list [aria-current="step"]')).toHaveCount(0)
  await expect(page.locator('[data-inventory="tray"] img')).toHaveAttribute('alt', route.label)
  await page.screenshot({ path: 'test-results/prep-phone-ready.png' })

  await dragTo(page, route.counter)
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().shift.served), { timeout: 2_000 }).toBe(1)
  const heard = await page.evaluate(() => (window as unknown as { __prepFrequencies: number[] }).__prepFrequencies)
  expect(heard).toEqual(expect.arrayContaining([440, 560, 523, 659, 784]))
})
