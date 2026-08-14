import { expect, test, type Page } from '@playwright/test'
import { advanceLabel } from '../src/shift-ui'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })

type Point = { x: number; y: number }

function includesSequence(values: number[], sequence: number[]): boolean {
  return values.some((_, start) => sequence.every((value, offset) => values[start + offset] === value))
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
      if (next.phase !== 'playing') throw new Error(`rush ended before reaching ${target.x},${target.y}`)
      await page.mouse.move(origin.x + next.dx / next.distance * 58, origin.y + next.dy / next.distance * 58)
      await page.waitForTimeout(35)
    }
    throw new Error(`pointer route did not reach ${target.x},${target.y}`)
  } finally {
    await page.mouse.up()
  }
}

async function finishShift(page: Page) {
  return page.evaluate(() => {
    const game = window.__scoopaloo
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const serveFront = () => {
      const state = game.snapshot()
      const front = state.customers.find(customer => !customer.served && !customer.missed)
      if (!front) { game.advance(.1); return }
      const direct = state.rules.intro?.directSources.find(source =>
        source.item === front.order.item && source.unlockAfterServes <= state.shift.served)
      if (direct) {
        for (let made = 0; made < front.order.quantity && game.snapshot().phase === 'playing'; made++) {
          const source = state.skin.producers[direct.source]
          const target = (game.snapshot().player.trayItems[front.order.item] ?? 0) + 1
          game.movePlayer(point(source.interaction))
          for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
            && (game.snapshot().player.trayItems[front.order.item] ?? 0) < target; tick++) game.advance(.2)
          const carried = game.snapshot().player.trayItems[front.order.item] ?? 0
          game.movePlayer(point(state.skin.stations.counter.interaction))
          for (let tick = 0; tick < 20 && game.snapshot().phase === 'playing'
            && (game.snapshot().player.trayItems[front.order.item] ?? 0) >= carried; tick++) game.advance(.1)
        }
        game.advance(1)
        return
      }
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
    const finished = game.snapshot()
    if (finished.phase === 'playing') throw new Error('shift simulation watchdog expired')
    return {
      phase: finished.phase,
      revenue: finished.shift.revenue,
      goal: finished.rules.cashGoal,
      level: finished.rules.level,
      best: finished.save.scoreChaseBest,
      dayStars: finished.save.dayStars,
      dayBestRevenue: finished.save.dayBestRevenue,
    }
  })
}

async function expectCardFits(page: Page, selector: string, name: string): Promise<void> {
  const result = await page.locator(selector).evaluate(card => {
    const box = card.getBoundingClientRect()
    const rules = card.querySelector<HTMLElement>('.rush-rules')!
    const labels = [...rules.querySelectorAll<HTMLElement>('b')]
    const values = [...rules.querySelectorAll<HTMLElement>('strong')]
    const buttons = [...card.querySelectorAll<HTMLButtonElement>('button')]
      .filter(button => button.getClientRects().length > 0)
    return {
      inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      noOverflow: card.scrollWidth <= card.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth,
      rulesVisible: rules.getClientRects().length > 0,
      labels: labels.map(label => ({ font: parseFloat(getComputedStyle(label).fontSize), fits: label.scrollWidth <= label.clientWidth })),
      values: values.map(value => ({ font: parseFloat(getComputedStyle(value).fontSize), fits: value.scrollWidth <= value.clientWidth })),
      buttons: buttons.map(button => ({ height: button.getBoundingClientRect().height, fits: button.scrollWidth <= button.clientWidth + 1 })),
    }
  })
  expect(result.inside, name).toBe(true)
  expect(result.noOverflow, name).toBe(true)
  expect(result.rulesVisible, name).toBe(true)
  expect(result.labels.every(label => label.font >= 13 && label.fits), name).toBe(true)
  expect(result.values.every(value => value.font >= 16 && value.fits), name).toBe(true)
  expect(result.buttons.every(button => button.height >= 44 && button.fits), name).toBe(true)
}

async function expectHudFits(page: Page, name: string): Promise<void> {
  const result = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
    const hud = box('.shift-hud')
    const panel = box('.order-panel')
    const save = box('#save-button')
    const sound = box('#sound-button')
    const inside = (rect: DOMRect) => rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
    const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const fit = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].map(element => ({
      font: parseFloat(getComputedStyle(element).fontSize),
      fits: element.scrollWidth <= element.clientWidth,
    }))
    return {
      inside: [hud, panel, save, sound].every(inside),
      clear: !overlap(hud, panel) && !overlap(hud, save) && !overlap(hud, sound) && !overlap(panel, save) && !overlap(panel, sound),
      labels: fit('.hud-stat > span:not(.sr-only)'),
      rules: fit('.hud-rule:not([hidden])'),
      totals: fit('.hud-stat strong'),
      portrait: innerWidth !== 390 || box('#game').height > box('#game').width,
    }
  })
  expect(result.inside, name).toBe(true)
  expect(result.clear, name).toBe(true)
  expect(result.labels.every(label => label.font >= 13 && label.fits), name).toBe(true)
  expect(result.rules.every(rule => rule.font >= 12 && rule.fits), name).toBe(true)
  expect(result.totals.every(total => total.fits), name).toBe(true)
  expect(result.portrait, name).toBe(true)
}

test('campaign-only final day keeps its replay fallback', () => {
  expect(advanceLabel({ day: 'DAY 3', finalDay: true, canStartScoreChase: false })).toBe('REPLAY DAY 3')
})

test('enters, plays, records, restores, advances, and retries Score Chase', async ({ context, page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    const frequencies: number[] = []
    Object.defineProperty(window, '__scoreFrequencies', { value: frequencies })
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
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.evaluate(() => window.__scoopaloo.pause(true))

  for (let day = 1; day <= 3; day++) {
    await page.getByRole('button', { name: 'START SHIFT' }).click()
    const result = await finishShift(page)
    expect(result.phase).toBe('results')
    expect(result.revenue).toBeGreaterThanOrEqual(result.goal)
    await expect(page.getByRole('heading', { name: 'SHIFT COMPLETE' })).toBeVisible()
    if (day < 3) {
      await page.getByRole('button', { name: 'UPGRADES' }).click()
      await page.getByRole('button', { name: 'NEXT DAY' }).click()
    }
  }

  await expect(page.getByText('SCORE CHASE UNLOCKED', { exact: true })).toBeVisible()
  const campaignRecords = await page.evaluate(() => {
    const save = window.__scoopaloo.snapshot().save
    return { stars: save.dayStars, revenue: save.dayBestRevenue }
  })
  await page.screenshot({ path: 'test-results/score-chase-phone-entry.png' })
  await page.getByRole('button', { name: 'UPGRADES' }).click()
  await expect(page.getByRole('button', { name: 'START SCORE CHASE' })).toBeVisible()
  await page.getByRole('button', { name: 'START SCORE CHASE' }).click()

  const rushOne = await page.evaluate(() => window.__scoopaloo.snapshot().rules)
  expect(rushOne).toMatchObject({ kind: 'score-chase', level: 1, label: 'RUSH', cashGoal: 140, spawnInterval: 7.5, customerPatience: 50 })
  await expect(page.getByText('RUSH 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '$140 GOAL' })).toBeVisible()
  await expect(page.getByText('FULL MENU SCORE CHASE', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'START RUSH' })).toBeVisible()
  await expect(page.locator('[data-field="ready-rush-rules"]')).toContainText(/GOAL\s*\$140\s*BEST\s*\$0\s*ARRIVALS\s*7\.5s\s*PATIENCE\s*50s/)

  for (const size of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size)
    await expectCardFits(page, '.ready-card', `${size.name} ready`)
    await page.screenshot({ path: `test-results/score-chase-${size.name}-ready.png` })
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('scoopaloo_save_v1')!).scoreChaseLevel)).toBe(1)
  await page.reload()
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await expect(page.getByText('RUSH 1', { exact: true })).toBeVisible()
  await context.setOffline(true)
  await page.reload()
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await expect(page.getByText('RUSH 1', { exact: true })).toBeVisible()
  await expect(page.locator('[data-field="ready-rush-best"]')).toHaveText('$0')
  await context.setOffline(false)

  await page.getByRole('button', { name: 'START RUSH' }).click()
  await expect(page.getByLabel(/Rush 1 status/)).toBeVisible()
  await expect(page.locator('[data-field="hud-mode"]')).toHaveText('RUSH/BEST')
  await expect(page.locator('[data-field="hud-day"]')).toHaveText('1')
  await expect(page.locator('[data-field="hud-best"]')).toHaveText(' · $0')
  await expect(page.locator('[data-field="hud-arrival"]')).toHaveText(' · 7.5s')
  await expect(page.locator('[data-field="hud-patience"]')).toHaveText(' · 50s')
  for (const size of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size)
    await expectHudFits(page, `${size.name} playing`)
    await page.screenshot({ path: `test-results/score-chase-${size.name}-playing.png` })
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.__scoopaloo.pause(false))
  const route = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const front = state.customers.find(customer => !customer.served && !customer.missed)!
    const recipe = state.skin.items[front.order.item].recipe!
    const inputs = Object.keys(recipe.inputs).map(item => {
      const producer = Object.values(state.skin.producers).find(candidate => candidate.item === item)!
      return { item, target: { x: producer.interaction[0], y: producer.interaction[1] } }
    })
    const prep = state.skin.prepStations[recipe.station].interaction
    const counter = state.skin.stations.counter.interaction
    return { item: front.order.item, inputs, prep: { x: prep[0], y: prep[1] }, counter: { x: counter[0], y: counter[1] } }
  })
  expect(route.item).toBe('chocolate-cone')
  for (const input of route.inputs) {
    await dragTo(page, { x: 480, y: input.target.y })
    await dragTo(page, input.target)
    await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, input.item)).toBe(1)
    await dragTo(page, { x: 480, y: input.target.y })
  }
  await dragTo(page, route.prep)
  await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, route.item), { timeout: 4_000 }).toBe(1)
  await dragTo(page, route.counter)
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().shift.served), { timeout: 3_000 }).toBe(1)
  await page.evaluate(() => window.__scoopaloo.pause(true))
  const heard = await page.evaluate(() => [...(window as unknown as { __scoreFrequencies: number[] }).__scoreFrequencies])
  expect(includesSequence(heard, [440, 560])).toBe(true)
  expect(includesSequence(heard, [523, 659, 784])).toBe(true)
  expect(includesSequence(heard, [740, 990])).toBe(true)

  const cleared = await finishShift(page)
  expect(cleared.phase).toBe('results')
  expect(cleared.revenue).toBeGreaterThanOrEqual(cleared.goal)
  expect(cleared.best).toBe(cleared.revenue)
  expect({ stars: cleared.dayStars, revenue: cleared.dayBestRevenue }).toEqual(campaignRecords)
  await expect(page.getByRole('heading', { name: 'RUSH CLEARED' })).toBeVisible()
  await expect(page.locator('[data-field="result-best"]')).toHaveText(`PRIOR $0 → NEW BEST $${cleared.best}`)

  for (const size of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size)
    await expectCardFits(page, '.results-card', `${size.name} results`)
    await page.screenshot({ path: `test-results/score-chase-${size.name}-results.png` })
  }

  await page.getByRole('button', { name: 'UPGRADES' }).click()
  await expect(page.getByRole('button', { name: 'NEXT RUSH' })).toBeVisible()
  for (const size of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size)
    await expectCardFits(page, '.shop-card', `${size.name} shop`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/score-chase-phone-shop.png' })
  await page.getByRole('button', { name: 'NEXT RUSH' }).click()

  await expect(page.getByText('RUSH 2', { exact: true })).toBeVisible()
  await expect(page.locator('[data-field="ready-rush-rules"]')).toContainText(new RegExp(`GOAL\\s*\\$150\\s*BEST\\s*\\$${cleared.best}\\s*ARRIVALS\\s*7\\.25s\\s*PATIENCE\\s*48s`))
  expect(await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    return {
      level: state.rules.level,
      goal: state.rules.cashGoal,
      arrival: state.rules.spawnInterval,
      patience: state.rules.customerPatience,
      first: state.rules.orderDeck[0],
      saved: state.save.scoreChaseLevel,
      best: state.save.scoreChaseBest,
    }
  })).toEqual({ level: 2, goal: 150, arrival: 7.25, patience: 48, first: { item: 'sundae', quantity: 2 }, saved: 2, best: cleared.best })

  await page.reload()
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await expect(page.getByText('RUSH 2', { exact: true })).toBeVisible()
  await expect(page.locator('[data-field="ready-rush-best"]')).toHaveText(`$${cleared.best}`)
  await page.getByRole('button', { name: 'START RUSH' }).click()
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.movePlayer({ x: 55, y: 1150 })
    game.advance(game.snapshot().shift.remaining)
  })
  await expect(page.getByRole('heading', { name: 'RUSH ENDED' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'RETRY RUSH 2' })).toBeVisible()
  await expect(page.locator('[data-field="result-best"]')).toHaveText(`PRIOR BEST $${cleared.best} · STILL $${cleared.best}`)
  await page.getByRole('button', { name: 'RETRY RUSH 2' }).click()
  await expect(page.getByLabel(/Rush 2 status/)).toBeVisible()
  expect(await page.evaluate(() => ({
    phase: window.__scoopaloo.snapshot().phase,
    level: window.__scoopaloo.snapshot().rules.level,
    saved: window.__scoopaloo.snapshot().save.scoreChaseLevel,
  }))).toEqual({ phase: 'playing', level: 2, saved: 2 })
})
