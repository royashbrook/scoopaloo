import { expect, test, type Locator, type Page } from '@playwright/test'

const PHONE_SIZES = [
  { name: 'iphone-375', width: 375, height: 812 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'iphone-air', width: 420, height: 912 },
] as const

const SAFE_TOP = 59
const SAFE_BOTTOM = 34

test.use({ hasTouch: true, reducedMotion: 'reduce' })

function gameMenu(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Game menu' })
}

function menuAction(page: Page, name: 'PLAY' | 'STORE' | 'SAVE' | 'SOUND'): Locator {
  const ids = {
    PLAY: '#play-button',
    STORE: '#store-button',
    SAVE: '#save-button',
    SOUND: '#sound-button',
  } as const
  return gameMenu(page).locator(ids[name])
}

async function seedSave(page: Page, scoreChaseLevel = 0): Promise<void> {
  await page.addInitScript(level => {
    if (!localStorage.getItem('scoopaloo_save_v1')) {
      localStorage.setItem('scoopaloo_save_v1', JSON.stringify({
        version: 1,
        coins: 250,
        currentDay: level ? 2 : 1,
        scoreChaseLevel: level,
        scoreChaseBest: level ? 190 : 0,
      }))
    }
  }, scoreChaseLevel)
}

async function setPhoneViewport(page: Page, size: (typeof PHONE_SIZES)[number]): Promise<void> {
  await page.setViewportSize({ width: size.width, height: size.height })
  await page.evaluate(({ safeTop, safeBottom }) => {
    document.documentElement.style.setProperty('--safe-top', `${safeTop}px`)
    document.documentElement.style.setProperty('--safe-bottom', `${safeBottom}px`)
    dispatchEvent(new Event('resize'))
  }, { safeTop: SAFE_TOP, safeBottom: SAFE_BOTTOM })
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function expectNoDocumentScroll(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement
    return {
      clientWidth: root.clientWidth,
      clientHeight: root.clientHeight,
      scrollWidth: root.scrollWidth,
      scrollHeight: root.scrollHeight,
      x: scrollX,
      y: scrollY,
    }
  })
  expect(report.scrollWidth).toBe(report.clientWidth)
  expect(report.scrollHeight).toBe(report.clientHeight)
  expect({ x: report.x, y: report.y }).toEqual({ x: 0, y: 0 })
}

async function expectMenuContract(page: Page): Promise<void> {
  const menu = gameMenu(page)
  await expect(menu).toBeVisible()
  const actions = ['PLAY', 'STORE', 'SAVE', 'SOUND'] as const
  for (const name of actions) {
    const button = menuAction(page, name)
    await expect(button).toBeVisible()
    await expect(button.locator('b')).toHaveText(name)
    const metrics = await button.evaluate((element, label) => {
      const box = element.getBoundingClientRect()
      const leaf = [...element.querySelectorAll<HTMLElement>('*')]
        .find(candidate => candidate.childElementCount === 0 && candidate.textContent?.trim() === label)
      return {
        width: box.width,
        height: box.height,
        labelFont: Number.parseFloat(getComputedStyle(leaf ?? element).fontSize),
        bottom: box.bottom,
      }
    }, name)
    expect(metrics.width, name).toBeGreaterThanOrEqual(44)
    expect(metrics.height, name).toBeGreaterThanOrEqual(44)
    expect(metrics.labelFont, name).toBeGreaterThanOrEqual(13)
    expect(metrics.bottom, name).toBeLessThanOrEqual(await page.evaluate(bottom => innerHeight - bottom, SAFE_BOTTOM) + 1)
  }

  const box = await menu.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
  expect(box!.y + box!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
}

async function openStore(page: Page): Promise<Locator> {
  await menuAction(page, 'STORE').click()
  const shop = page.getByRole('dialog', { name: 'UPGRADE SHOP' })
  await expect(shop).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().phase)).toBe('shop')
  return shop
}

async function closeStore(page: Page, phase: 'ready' | 'results'): Promise<void> {
  const shop = page.getByRole('dialog', { name: 'UPGRADE SHOP' })
  const back = shop.locator('[data-action="back"]')
  await expect(back).toBeVisible()
  await back.click()
  await expect(shop).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().phase)).toBe(phase)
}

test('bottom menu actions work outside a shift and Store returns to ready or results', async ({ page }) => {
  await seedSave(page)
  await page.goto('/')

  for (const [index, size] of PHONE_SIZES.entries()) {
    await setPhoneViewport(page, size)
    await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().phase)).toBe('ready')
    await expectMenuContract(page)
    await expectNoDocumentScroll(page)
    await page.screenshot({ path: `test-results/mobile-shell-${size.name}-ready.png` })

    const shop = await openStore(page)
    await expect(shop.locator('[data-field="shop-retry"]')).toHaveText('START DAY 2')
    if (index === 0) {
      const before = await page.evaluate(() => window.__scoopaloo.snapshot().save)
      const buy = shop.locator('button[data-upgrade]:not(:disabled)').first()
      await expect(buy).toBeVisible()
      await buy.click()
      await expect.poll(() => page.evaluate(coins => window.__scoopaloo.snapshot().save.coins < coins, before.coins)).toBe(true)
      const after = await page.evaluate(() => window.__scoopaloo.snapshot().save)
      expect(Object.values(after.upgrades).some(level => level > 0)).toBe(true)
    }
    await page.screenshot({ path: `test-results/mobile-shell-${size.name}-store.png` })
    await closeStore(page, 'ready')
    await expectMenuContract(page)
  }

  await setPhoneViewport(page, PHONE_SIZES[0])
  await page.evaluate(() => { document.querySelector<HTMLButtonElement>('#update-toast')!.hidden = false })
  const toastClear = await page.evaluate(() => {
    const toast = document.querySelector('#update-toast')!.getBoundingClientRect()
    const menu = document.querySelector('#bottom-nav')!.getBoundingClientRect()
    return toast.bottom <= menu.top
  })
  expect(toastClear).toBe(true)
  await page.evaluate(() => { document.querySelector<HTMLButtonElement>('#update-toast')!.hidden = true })
  const save = menuAction(page, 'SAVE')
  await save.click()
  const saveDialog = page.getByRole('dialog', { name: 'MOVE YOUR SAVE' })
  await expect(saveDialog).toBeVisible()
  await saveDialog.getByRole('button', { name: 'Close' }).click()
  await expect(saveDialog).not.toBeVisible()

  const sound = menuAction(page, 'SOUND')
  await expect(sound).toHaveAttribute('aria-pressed', 'true')
  await sound.click()
  await expect(sound).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => localStorage.getItem('scoopaloo.sound.muted.v1'))).toBe('1')
  await page.reload()
  await setPhoneViewport(page, PHONE_SIZES[0])
  await expect(menuAction(page, 'SOUND')).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => Object.values(window.__scoopaloo.snapshot().save.upgrades)
    .some(level => level > 0))).toBe(true)

  await menuAction(page, 'PLAY').click()
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().phase)).toBe('playing')
  await expect(gameMenu(page)).toBeHidden()

  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.advance(game.snapshot().shift.remaining)
  })
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().phase)).toBe('results')
  await expect(page.getByRole('heading', { name: 'GOAL MISSED' })).toBeVisible()
  await expectMenuContract(page)

  const resultsShop = await openStore(page)
  await expect(resultsShop.locator('[data-field="shop-retry"]')).toHaveText('RETRY DAY 2')
  await closeStore(page, 'results')
  await expect(page.getByRole('heading', { name: 'GOAL MISSED' })).toBeVisible()
  await expectMenuContract(page)
})

test('Rush HUD and order panel use the full safe width without clipping at every phone gate', async ({ page }) => {
  // Level 8 rotates CHOCOLATE SUNDAE, the longest current product label, to the front.
  await seedSave(page, 8)
  await page.setViewportSize({ width: PHONE_SIZES[0].width, height: PHONE_SIZES[0].height })
  await page.goto('/')
  await setPhoneViewport(page, PHONE_SIZES[0])
  await page.getByRole('button', { name: 'START RUSH' }).click()
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await expect(page.locator('[data-field="order-label"]')).toHaveText('CHOCOLATE SUNDAE')

  for (const size of PHONE_SIZES) {
    await setPhoneViewport(page, size)
    await expect(gameMenu(page)).toBeHidden()
    await expectNoDocumentScroll(page)

    const layout = await page.evaluate(({ safeTop, safeBottom }) => {
      const element = (selector: string) => document.querySelector<HTMLElement>(selector)!
      const box = (selector: string) => {
        const { left, top, right, bottom, width, height } = element(selector).getBoundingClientRect()
        return { left, top, right, bottom, width, height }
      }
      const inside = (rect: ReturnType<typeof box>) => rect.left >= 0 && rect.top >= safeTop
        && rect.right <= innerWidth && rect.bottom <= innerHeight - safeBottom
      const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      const visible = (candidate: HTMLElement) => {
        const style = getComputedStyle(candidate)
        return style.display !== 'none' && style.visibility !== 'hidden' && candidate.clientWidth > 0
      }
      const fitReport = (selectors: string[]) => selectors.flatMap(selector =>
        [...document.querySelectorAll<HTMLElement>(selector)].filter(visible).map(candidate => ({
          selector,
          text: candidate.textContent?.trim() ?? '',
          fitsX: candidate.scrollWidth <= candidate.clientWidth + 1,
          fitsY: candidate.scrollHeight <= candidate.clientHeight + 1,
        })))
      const minFont = (selectors: string[]) => Math.min(...selectors.flatMap(selector =>
        [...document.querySelectorAll<HTMLElement>(selector)].filter(visible)
          .map(candidate => Number.parseFloat(getComputedStyle(candidate).fontSize))))

      const hud = box('.shift-hud')
      const panel = box('.order-panel')
      const ticket = box('.order-ticket')
      const rail = box('.next-orders')
      const orderName = element('[data-field="order-label"]')
      const orderStyle = getComputedStyle(orderName)
      const view = window.__scoopaloo.viewport()
      const state = window.__scoopaloo.snapshot()
      const client = ([x, y]: number[]) => ({ x: (x - view.originX) * view.scale, y: (y - view.originY) * view.scale })
      const worldRect = (left: number, top: number, right: number, bottom: number) => ({
        left: client([left, top]).x,
        top: client([left, top]).y,
        right: client([right, bottom]).x,
        bottom: client([right, bottom]).y,
        width: (right - left) * view.scale,
        height: (bottom - top) * view.scale,
      })
      const counter = state.skin.stations.counter
      const [counterX, counterY] = counter.interaction
      const [drawX, drawY, drawWidth, drawHeight] = counter.draw
      const serviceEnvelopes = [
        worldRect(Math.min(drawX, counterX - 92), Math.min(drawY, counterY - 113),
          Math.max(drawX + drawWidth, counterX + 70), Math.max(drawY + drawHeight, counterY + 30)),
        worldRect(counterX - 8, counterY - 117, counterX + 180, counterY + 90),
      ]
      const interactionPoints = [
        ...Object.values(state.skin.producers).map(station => station.interaction),
        ...Object.values(state.skin.prepStations).map(station => station.interaction),
      ].map(client)
      const chrome = [hud, panel]
      const pointCovered = (point: { x: number; y: number }, rect: ReturnType<typeof box>) =>
        point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
      const gap = ticket.left - rail.right
      const critical = fitReport([
        '.hud-stat > span:not(.sr-only)',
        '.hud-stat > strong',
        '.patience-values b',
        '[data-field="order-label"]',
        '[data-field="order-payout"]',
        '[data-field="ticket-guidance"]',
        '.recipe-list span',
        '.next-position',
        '.next-orders b',
        '.next-state',
        '.next-seconds',
      ])

      return {
        width: innerWidth,
        hud,
        panel,
        ticket,
        rail,
        gap,
        inside: [hud, panel, ticket, rail].every(inside),
        chromeClear: !overlaps(hud, panel),
        serviceClear: serviceEnvelopes.every(envelope => chrome.every(rect => !overlaps(envelope, rect))),
        interactionsClear: interactionPoints.every(point => chrome.every(rect => !pointCovered(point, rect))),
        critical,
        order: {
          text: orderName.textContent?.trim(),
          fits: orderName.scrollWidth <= orderName.clientWidth + 1,
          oneLine: orderName.clientHeight <= Number.parseFloat(orderStyle.lineHeight) * 1.25,
        },
        fonts: {
          hudAndRail: minFont(['.hud-stat > span:not(.sr-only)', '.next-heading', '.next-state', '.next-seconds']),
          guidance: Number.parseFloat(getComputedStyle(element('[data-field="ticket-guidance"]')).fontSize),
        },
      }
    }, { safeTop: SAFE_TOP, safeBottom: SAFE_BOTTOM })

    expect(layout.inside, size.name).toBe(true)
    expect(layout.chromeClear, size.name).toBe(true)
    expect(layout.serviceClear, size.name).toBe(true)
    expect(layout.interactionsClear, size.name).toBe(true)
    expect(layout.hud.left, size.name).toBeGreaterThanOrEqual(8)
    expect(layout.panel.left, size.name).toBeGreaterThanOrEqual(8)
    expect(layout.width - layout.hud.right, size.name).toBeGreaterThanOrEqual(8)
    expect(layout.width - layout.panel.right, size.name).toBeGreaterThanOrEqual(8)
    expect(Math.abs(layout.hud.left - (layout.width - layout.hud.right)), size.name).toBeLessThanOrEqual(1)
    expect(Math.abs(layout.panel.left - (layout.width - layout.panel.right)), size.name).toBeLessThanOrEqual(1)
    expect(layout.hud.width, size.name).toBeGreaterThanOrEqual(layout.width - 24)
    expect(layout.panel.width, size.name).toBeGreaterThanOrEqual(layout.width - 24)
    expect(layout.rail.width, size.name).toBeCloseTo(52, 0)
    expect(layout.gap, size.name).toBeCloseTo(6, 0)
    expect(layout.ticket.width, size.name).toBeGreaterThanOrEqual(layout.width - 84)
    expect(layout.order, size.name).toEqual({ text: 'CHOCOLATE SUNDAE', fits: true, oneLine: true })
    expect(layout.critical.filter(item => !item.fitsX || !item.fitsY), size.name).toEqual([])
    expect(layout.fonts.hudAndRail, size.name).toBeGreaterThanOrEqual(13)
    expect(layout.fonts.guidance, size.name).toBeGreaterThanOrEqual(15)
    await page.screenshot({ path: `test-results/mobile-shell-${size.name}-rush.png` })
  }
})
