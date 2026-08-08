import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })

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
  await page.goto('/')
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await page.getByRole('button', { name: 'START SHIFT' }).click()
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
  await expect(page.getByText('DOUBLE-SCOOP DASH', { exact: true })).toBeVisible()
  expect((await page.evaluate(() => window.__scoopaloo.snapshot().save.currentDay))).toBe(1)
  await page.screenshot({ path: 'test-results/campaign-phone-day-2.png' })

  await page.reload()
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await expect(page.getByRole('heading', { name: `$${dayTwoGoal} GOAL` })).toBeVisible()
  expect((await page.evaluate(() => window.__scoopaloo.snapshot().save.upgrades.shoes))).toBe(1)
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  const dayTwoSpeed = await page.evaluate(() => {
    const game = window.__scoopaloo
    game.movePlayer({ x: 200, y: 470 })
    const before = game.snapshot().player.x
    game.advance(1, { x: 1, y: 0 })
    return game.snapshot().player.x - before
  })
  expect(dayTwoSpeed).toBeGreaterThanOrEqual(dayOne.speed + 24)
})
