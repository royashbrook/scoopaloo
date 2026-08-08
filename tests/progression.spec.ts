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
        return { dx, dy, distance: Math.hypot(dx, dy), phase: state.phase }
      }, target)
      if (next.distance < 52) return
      if (next.phase !== 'playing') throw new Error(`shift ended before reaching ${target.x},${target.y}`)
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

function includesSequence(values: number[], sequence: number[]): boolean {
  return values.some((_, start) => sequence.every((value, offset) => values[start + offset] === value))
}

async function finishCurrentDay(page: Page): Promise<{ speed: number; revenue: number; goal: number }> {
  return page.evaluate(() => {
    const game = window.__scoopaloo
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const moveTo = (target: { x: number; y: number }) => {
      game.movePlayer(target)
    }
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
          moveTo(point(producer.interaction))
          for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
            && (game.snapshot().player.trayItems[input] ?? 0) < target; tick++) game.advance(.2)
        }
        const before = game.snapshot().player.trayItems[front.order.item] ?? 0
        moveTo(point(state.skin.prepStations[recipe.station].interaction))
        for (let tick = 0; tick < 100 && game.snapshot().phase === 'playing'
          && (game.snapshot().player.trayItems[front.order.item] ?? 0) <= before; tick++) game.advance(.2)
        const carried = game.snapshot().player.trayItems[front.order.item] ?? 0
        moveTo(point(state.skin.stations.counter.interaction))
        for (let tick = 0; tick < 20 && game.snapshot().phase === 'playing'
          && (game.snapshot().player.trayItems[front.order.item] ?? 0) >= carried; tick++) game.advance(.1)
      }
      game.advance(1)
    }

    game.movePlayer({ x: 200, y: 470 })
    const before = game.snapshot().player.x
    game.advance(1, { x: 1, y: 0 })
    const speed = game.snapshot().player.x - before
    while (game.snapshot().phase === 'playing') serveFront()
    const finished = game.snapshot()
    return {
      speed,
      revenue: finished.shift.revenue,
      goal: finished.skin.days[finished.save.currentDay].cashGoal,
    }
  })
}

async function expectShopFits(page: Page): Promise<void> {
  const layout = await page.locator('.shop-card').evaluate(dialog => {
    const visibleButtons = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .filter(button => button.getClientRects().length > 0)
    const cards = [...dialog.querySelectorAll<HTMLElement>('[data-upgrade-card]')]
    const inside = (element: Element) => {
      const box = element.getBoundingClientRect()
      return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    }
    return {
      dialogInside: inside(dialog),
      cardsInside: cards.every(inside),
      noHorizontalScroll: dialog.scrollWidth <= dialog.clientWidth + 1,
      buttons: visibleButtons.map(button => ({
        fits: button.scrollWidth <= button.clientWidth + 1,
        height: button.getBoundingClientRect().height,
      })),
      cardType: cards.map(card => parseFloat(getComputedStyle(card.querySelector('h2')!).fontSize)),
    }
  })
  expect(layout.dialogInside).toBe(true)
  expect(layout.cardsInside).toBe(true)
  expect(layout.noHorizontalScroll).toBe(true)
  expect(layout.buttons.every(button => button.fits && button.height >= 44)).toBe(true)
  expect(layout.cardType.every(size => size >= 13)).toBe(true)
}

test('finishes Day 1, buys a visible upgrade, and restores Day 2 with its real effect', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => {
    const recorded: number[] = []
    Object.defineProperty(window, '__flavorFrequencies', { value: recorded })
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
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.atlasReady())).toBe(true)
  expect(await page.evaluate(() => ({
    active: 'chocolate-scoop' in window.__scoopaloo.snapshot().sources,
    unlocked: window.__scoopaloo.snapshot().save.unlockedStations.includes('chocolate-scoop'),
  }))).toEqual({ active: false, unlocked: false })
  await page.evaluate(() => window.__scoopaloo.setTime(.5))
  await page.screenshot({ path: 'test-results/flavor-day1-locked-phone.png' })
  const dayOne = await finishCurrentDay(page)

  await expect(page.getByRole('heading', { name: 'SHIFT COMPLETE' })).toBeVisible()
  expect(dayOne.revenue).toBeGreaterThanOrEqual(dayOne.goal)
  await page.getByRole('button', { name: 'UPGRADES' }).click()

  const shop = page.getByRole('dialog', { name: 'UPGRADE SHOP' })
  await expect(shop).toBeVisible()
  await expect(page.locator('[data-upgrade-card]')).toHaveCount(4)
  expect(await page.locator('[data-upgrade-card][data-affordable="true"]').count()).toBeGreaterThanOrEqual(2)
  await expect(page.locator('#shop-title')).toBeFocused()

  for (const size of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.waitForTimeout(50)
    await expectShopFits(page)
    await page.screenshot({ path: `test-results/campaign-${size.name}-shop.png` })
  }

  const speedCard = page.locator('[data-upgrade-card="shoes"]')
  await expect(speedCard).toHaveAttribute('data-level', '0')
  const before = await page.evaluate(() => window.__scoopaloo.snapshot().save)
  const price = Number(await speedCard.getAttribute('data-price'))
  await speedCard.getByRole('button').click()
  await expect(speedCard).toHaveAttribute('data-level', '1')
  const afterPurchase = await page.evaluate(() => window.__scoopaloo.snapshot().save)
  expect(afterPurchase.coins).toBe(before.coins - price)
  expect(afterPurchase.upgrades.shoes).toBe(1)

  await page.getByRole('button', { name: 'NEXT DAY' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  const dayTwoGoal = await page.evaluate(() => window.__scoopaloo.snapshot().skin.days[1].cashGoal)
  await expect(page.getByRole('heading', { name: `$${dayTwoGoal} GOAL` })).toBeVisible()
  await expect(page.getByText('CHOCOLATE RUSH', { exact: true })).toBeVisible()
  await expect(page.getByText('CHOCOLATE MACHINE UNLOCKED', { exact: true })).toBeVisible()
  expect((await page.evaluate(() => window.__scoopaloo.snapshot().save.currentDay))).toBe(1)
  expect(await page.evaluate(() => ({
    active: 'chocolate-scoop' in window.__scoopaloo.snapshot().sources,
    unlocked: window.__scoopaloo.snapshot().save.unlockedStations.includes('chocolate-scoop'),
  }))).toEqual({ active: true, unlocked: true })
  await page.screenshot({ path: 'test-results/campaign-phone-day-2.png' })
  await page.screenshot({ path: 'test-results/flavor-day2-ready-phone.png' })
  const unlockHeard = await page.evaluate(() => [...(window as unknown as { __flavorFrequencies: number[] }).__flavorFrequencies])
  expect(includesSequence(unlockHeard, [392, 523, 659])).toBe(true)

  await page.reload()
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await expect(page.getByRole('heading', { name: `$${dayTwoGoal} GOAL` })).toBeVisible()
  await expect(page.getByText('CHOCOLATE MACHINE UNLOCKED', { exact: true })).toBeVisible()
  expect((await page.evaluate(() => window.__scoopaloo.snapshot().save.upgrades.shoes))).toBe(1)
  expect(await page.evaluate(() => ({
    active: 'chocolate-scoop' in window.__scoopaloo.snapshot().sources,
    unlocked: window.__scoopaloo.snapshot().save.unlockedStations.includes('chocolate-scoop'),
  }))).toEqual({ active: true, unlocked: true })
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  const dayTwoSpeed = await page.evaluate(() => {
    const game = window.__scoopaloo
    game.movePlayer({ x: 200, y: 470 })
    const before = game.snapshot().player.x
    game.advance(1, { x: 1, y: 0 })
    return game.snapshot().player.x - before
  })
  expect(dayTwoSpeed).toBeGreaterThanOrEqual(dayOne.speed + 24)

  await expect(page.getByLabel('Current order')).toContainText('CHOCOLATE CONE')
  const route = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const front = state.customers.find(customer => !customer.served && !customer.missed)!
    const recipe = state.skin.items[front.order.item].recipe!
    const producer = (item: string) => {
      const found = Object.values(state.skin.producers).find(candidate => candidate.item === item)!
      return { x: found.interaction[0], y: found.interaction[1] }
    }
    const prep = state.skin.prepStations[recipe.station].interaction
    const counter = state.skin.stations.counter.interaction
    return {
      item: front.order.item,
      chocolate: producer('chocolate-scoop'),
      cone: producer('cone-shell'),
      prep: { x: prep[0], y: prep[1] },
      counter: { x: counter[0], y: counter[1] },
    }
  })
  expect(route.item).toBe('chocolate-cone')

  await page.evaluate(() => window.__scoopaloo.pause(false))
  await dragTo(page, { x: 480, y: 1070 })
  await dragTo(page, route.chocolate)
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().player.trayItems['chocolate-scoop'] ?? 0)).toBe(1)

  const ticketLayout = await page.evaluate(() => {
    const ticket = document.querySelector('.order-ticket')!.getBoundingClientRect()
    const chocolate = [...document.querySelectorAll<HTMLElement>('.recipe-list span')]
      .find(element => element.textContent === 'CHOCOLATE')!
    const recipeStyle = getComputedStyle(chocolate)
    const guidanceStyle = getComputedStyle(document.querySelector('[data-field="ticket-guidance"]')!)
    return {
      height: ticket.height,
      chocolateWidth: { scroll: chocolate.scrollWidth, client: chocolate.clientWidth },
      recipeFont: parseFloat(recipeStyle.fontSize),
      guidanceFont: parseFloat(guidanceStyle.fontSize),
    }
  })
  expect(ticketLayout.height).toBeLessThanOrEqual(244)
  expect(ticketLayout.chocolateWidth.scroll).toBeLessThanOrEqual(ticketLayout.chocolateWidth.client)
  expect(ticketLayout.recipeFont).toBeGreaterThanOrEqual(12)
  expect(ticketLayout.guidanceFont).toBeGreaterThanOrEqual(13)
  await page.screenshot({ path: 'test-results/flavor-day2-order-phone.png' })

  // The two source rows align, so use the center aisle before crossing into a
  // station. This is the same path available to one thumb, not a state warp.
  await dragTo(page, { x: 480, y: 1070 })
  await dragTo(page, { x: 480, y: 920 })
  await dragTo(page, route.cone)
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().player.trayItems['cone-shell'] ?? 0)).toBe(1)
  await dragTo(page, { x: 480, y: 920 })
  await dragTo(page, route.prep)
  await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, route.item), {
    timeout: 4_000,
  }).toBe(1)
  await dragTo(page, route.counter)
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().shift.served), { timeout: 3_000 }).toBe(1)

  const heard = await page.evaluate(() => [...(window as unknown as { __flavorFrequencies: number[] }).__flavorFrequencies])
  expect(includesSequence(heard, [440, 560])).toBe(true)
  expect(includesSequence(heard, [523, 659, 784])).toBe(true)
  expect(includesSequence(heard, [740, 990])).toBe(true)
})
