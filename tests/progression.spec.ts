import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })

async function finishCurrentDay(page: Page): Promise<{ speed: number; revenue: number }> {
  return page.evaluate(() => {
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

    game.movePlayer({ x: 200, y: 470 })
    const before = game.snapshot().player.x
    game.advance(1, { x: 1, y: 0 })
    const speed = game.snapshot().player.x - before
    while (game.snapshot().phase === 'playing') serveFront()
    return { speed, revenue: game.snapshot().shift.revenue }
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
  expect(dayOne.revenue).toBeGreaterThanOrEqual(60)
  await page.getByRole('button', { name: 'UPGRADES' }).click()

  const shop = page.getByRole('dialog', { name: 'UPGRADE SHOP' })
  await expect(shop).toBeVisible()
  await expect(page.locator('[data-upgrade-card]')).toHaveCount(4)
  await expect(page.locator('[data-upgrade-card][data-affordable="true"]')).toHaveCount(2)
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
  await expect(page.getByRole('heading', { name: '$100 GOAL' })).toBeVisible()
  await expect(page.getByText('DOUBLE-SCOOP DASH', { exact: true })).toBeVisible()
  expect((await page.evaluate(() => window.__scoopaloo.snapshot().save.currentDay))).toBe(1)
  await page.screenshot({ path: 'test-results/campaign-phone-day-2.png' })

  await page.reload()
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await expect(page.getByRole('heading', { name: '$100 GOAL' })).toBeVisible()
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
