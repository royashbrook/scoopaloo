import { expect, test, type Locator, type Page } from '@playwright/test'
import { defaultSave, type SaveV1 } from '../src/engine'
import { SAVE_KEY } from '../src/save'
import type { GameSkin } from '../src/skin'
import skinData from '../src/skins/ice-cream.json' with { type: 'json' }

const SKIN = skinData as GameSkin
const SAFE_TOP = 59
const SAFE_BOTTOM = 34
const PHONE = { width: 390, height: 844 }
const PHONES = [
  { name: 'iphone-375', width: 375, height: 812 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'iphone-air', width: 420, height: 912 },
] as const
type Point = { x: number; y: number }
let replacementSerial = 0

test.use({ viewport: PHONE, hasTouch: true, reducedMotion: 'reduce' })

function completedSave(built: 0 | 1, coins = 0, rush = true): SaveV1 {
  const save = defaultSave(SKIN)
  return {
    ...save,
    coins,
    lifetimeCash: Math.max(coins, 250),
    currentDay: 2,
    unlockedStations: [...new Set([...save.unlockedStations, 'chocolate-scoop'])],
    upgrades: {
      ...save.upgrades,
      shoes: 3,
      tray: 1,
      machine: 3,
      patience: 3,
      helper: 0,
      'second-counter': built,
    },
    bestRevenue: 70,
    bestStars: 1,
    dayStars: [1, 1, 1],
    dayBestRevenue: [45, 60, 70],
    scoreChaseLevel: rush ? 1 : 0,
    scoreChaseBest: rush ? 140 : 0,
  }
}

function unfinishedSave(): SaveV1 {
  const save = completedSave(0, 250, false)
  return { ...save, dayStars: [1, 1, 0], dayBestRevenue: [45, 60, 69] }
}

async function seed(page: Page, save: SaveV1): Promise<void> {
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value))
  }, {
    key: SAVE_KEY,
    value: save,
  })
}

async function replaceSave(page: Page, save: SaveV1): Promise<void> {
  const marker = `scoopaloo.replace.${++replacementSerial}`
  await page.addInitScript(({ key, value, markerKey }) => {
    if (sessionStorage.getItem(markerKey) !== '1') return
    localStorage.setItem(key, JSON.stringify(value))
    sessionStorage.removeItem(markerKey)
  }, {
    key: SAVE_KEY,
    value: save,
    markerKey: marker,
  })
  await page.evaluate(markerKey => sessionStorage.setItem(markerKey, '1'), marker)
  await page.reload()
}

async function setSafeArea(page: Page, top = SAFE_TOP, bottom = SAFE_BOTTOM): Promise<void> {
  await page.evaluate(({ topInset, bottomInset }) => {
    document.documentElement.style.setProperty('--safe-top', `${topInset}px`)
    document.documentElement.style.setProperty('--safe-bottom', `${bottomInset}px`)
    dispatchEvent(new Event('resize'))
  }, { topInset: top, bottomInset: bottom })
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

function storeButton(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Game menu' }).locator('#store-button')
}

async function openStore(page: Page): Promise<Locator> {
  await storeButton(page).click()
  const shop = page.getByRole('dialog', { name: 'UPGRADE SHOP' })
  await expect(shop).toBeVisible()
  return shop
}

async function expectNoDocumentScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement
    return {
      client: [root.clientWidth, root.clientHeight],
      scroll: [root.scrollWidth, root.scrollHeight],
      position: [scrollX, scrollY],
    }
  })).toEqual({
    client: await page.evaluate(() => [innerWidth, innerHeight]),
    scroll: await page.evaluate(() => [innerWidth, innerHeight]),
    position: [0, 0],
  })
}

async function expectDockFits(page: Page, safeBottom: number): Promise<void> {
  const menu = page.getByRole('navigation', { name: 'Game menu' })
  await expect(menu).toBeVisible()
  const report = await menu.evaluate((nav, bottomInset) => {
    const buttons = [...nav.querySelectorAll('button')]
    const boxes = buttons.map(button => {
      const { left, right, bottom, width, height } = button.getBoundingClientRect()
      return { left, right, bottom, width, height }
    })
    return {
      count: buttons.length,
      inside: boxes.every(box => box.left >= 0 && box.right <= innerWidth
        && box.bottom <= innerHeight - bottomInset + 1),
      targets: boxes.every(box => box.width >= 44 && box.height >= 44),
    }
  }, safeBottom)
  expect(report).toEqual({ count: 4, inside: true, targets: true })
}

async function expectShopFits(page: Page, card: Locator, safeTop: number, safeBottom: number): Promise<void> {
  await card.scrollIntoViewIfNeeded()
  const report = await card.evaluate((target, safe) => {
    const shop = target.closest<HTMLDialogElement>('.shop-card')!
    const button = target.querySelector('button')!
    const box = (element: Element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
      return { left, top, right, bottom, width, height }
    }
    const dialog = box(shop)
    const construction = box(target)
    const action = box(button)
    const inside = (rect: ReturnType<typeof box>) => rect.left >= 0 && rect.right <= innerWidth
      && rect.top >= safe.safeTop && rect.bottom <= innerHeight - safe.safeBottom
    return {
      dialog,
      construction,
      action,
      dialogInside: inside(dialog),
      constructionInside: inside(construction),
      actionHeight: action.height,
      noHorizontalScroll: shop.scrollWidth <= shop.clientWidth + 1,
      noVerticalScroll: shop.scrollHeight <= shop.clientHeight + 1,
      buttonFits: button.scrollWidth <= button.clientWidth + 1,
    }
  }, { safeTop, safeBottom })
  expect(report.dialogInside, JSON.stringify(report)).toBe(true)
  expect(report.constructionInside, JSON.stringify(report)).toBe(true)
  expect(report.actionHeight).toBeGreaterThanOrEqual(44)
  expect(
    report.noHorizontalScroll && report.noVerticalScroll && report.buttonFits,
    JSON.stringify(report),
  ).toBe(true)
}

async function withHeldJoystick(page: Page, route: (move: (target: Point) => Promise<void>) => Promise<void>): Promise<void> {
  const size = page.viewportSize()!
  const origin = { x: size.width / 2, y: Math.min(size.height - 180, 660) }
  const stop = () => page.mouse.move(origin.x, origin.y)
  const move = async (target: Point) => {
    for (let tick = 0; tick < 420; tick++) {
      const next = await page.evaluate(goal => {
        const state = window.__scoopaloo.snapshot()
        const dx = goal.x - state.player.x
        const dy = goal.y - state.player.y
        return { dx, dy, distance: Math.hypot(dx, dy), phase: state.phase }
      }, target)
      if (next.distance < 50) {
        await stop()
        return
      }
      if (next.phase !== 'playing') throw new Error(`shift ended before reaching ${target.x},${target.y}`)
      await page.mouse.move(
        origin.x + next.dx / next.distance * 60,
        origin.y + next.dy / next.distance * 60,
      )
      await page.waitForTimeout(35)
    }
    throw new Error(`held pointer route did not reach ${target.x},${target.y}`)
  }

  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  try {
    await route(move)
  } finally {
    await page.mouse.up()
  }
}

async function pointerPrepareAndDrop(page: Page, lane: 'primary' | 'secondary', screenshot: string): Promise<void> {
  await page.getByRole('button', { name: 'START RUSH' }).click()
  const route = await page.evaluate(selected => {
    const state = window.__scoopaloo.snapshot()
    const order = state.customers[0]!.order
    const recipe = state.skin.items[order.item].recipe!
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const sources = Object.entries(recipe.inputs).flatMap(([item, count]) => {
      const producer = Object.values(state.skin.producers).find(candidate => candidate.item === item)!
      return Array.from({ length: count }, () => ({ item, point: point(producer.interaction) }))
    })
    const counter = selected === 'primary'
      ? point(state.skin.stations.counter.interaction)
      : point(state.skin.counterExpansion!.station.interaction)
    return { item: order.item, sources, prep: point(state.skin.prepStations[recipe.station].interaction), counter }
  }, lane)

  await withHeldJoystick(page, async move => {
    for (const source of route.sources) {
      const before = await page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, source.item)
      await move(source.point)
      await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, source.item), {
        timeout: 4_000,
      }).toBe(before + 1)
    }
    await move(route.prep)
    await expect.poll(() => page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, route.item), {
      timeout: 5_000,
    }).toBe(1)
    await move(route.counter)
    await expect.poll(() => page.evaluate(({ item, point }) => window.__scoopaloo.snapshot().events.some(event =>
      event.kind === 'drop' && event.item === item && event.x === point.x && event.y === point.y), {
      item: route.item,
      point: route.counter,
    }), { timeout: 2_000 }).toBe(true)
    await page.evaluate(() => window.__scoopaloo.pause(true))
  })

  const receipt = await page.evaluate(({ item, point }) => {
    const state = window.__scoopaloo.snapshot()
    const drop = [...state.events].reverse().find(event => event.kind === 'drop' && event.item === item)!
    return {
      drop: { x: drop.x, y: drop.y, from: drop.from },
      counterItems: state.counter.items[item] ?? 0,
      trayItems: state.player.trayItems[item] ?? 0,
      point,
    }
  }, { item: route.item, point: route.counter })
  expect(receipt.drop).toMatchObject({ x: receipt.point.x, y: receipt.point.y })
  expect(receipt.drop.from).toBeDefined()
  expect(receipt.trayItems).toBe(0)
  expect(receipt.counterItems).toBeGreaterThanOrEqual(1)
  await page.screenshot({ path: screenshot })
}

test('the post-campaign counter build is gated, costs exactly $250 once, persists, and fits every shell', async ({ page }) => {
  await seed(page, unfinishedSave())
  await page.goto('/')
  await setSafeArea(page)
  await expectNoDocumentScroll(page)

  let shop = await openStore(page)
  let card = shop.locator('[data-upgrade-card="second-counter"]')
  await expect(card).toHaveCount(0)
  const helperCard = shop.locator('[data-upgrade-card="helper"]')
  await expectShopFits(page, helperCard, SAFE_TOP, SAFE_BOTTOM)
  await page.screenshot({ path: 'test-results/second-counter-phone-hidden.png' })

  await replaceSave(page, completedSave(0, 249, false))
  await setSafeArea(page)
  shop = await openStore(page)
  card = shop.locator('[data-upgrade-card="second-counter"]')
  await expect(card).toHaveAttribute('data-affordable', 'false')
  await expect(card.locator('[data-upgrade="second-counter"]')).toBeDisabled()
  await expect(card.locator('[data-upgrade="second-counter"]')).toHaveText('NEED $250')

  await replaceSave(page, completedSave(0, 250, false))
  await setSafeArea(page)
  shop = await openStore(page)
  card = shop.locator('[data-upgrade-card="second-counter"]')
  const build = card.locator('[data-upgrade="second-counter"]')
  await expect(build).toBeEnabled()
  await expect(build).toHaveText('BUILD $250')
  await expect(card).toHaveAttribute('data-price', '250')
  await build.click()
  await expect(card.locator('[data-upgrade="second-counter"]')).toHaveText('BUILT')
  await expect(card.locator('[data-upgrade="second-counter"]')).toBeDisabled()
  await expect(page.locator('[data-field="purchase-status"]')).toHaveText('SECOND COUNTER built. Two customers can now be served at once.')

  expect(await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const stored = JSON.parse(localStorage.getItem('scoopaloo_save_v1')!) as SaveV1
    return {
      coins: state.save.coins,
      level: state.save.upgrades['second-counter'],
      storedCoins: stored.coins,
      storedLevel: stored.upgrades['second-counter'],
    }
  })).toEqual({ coins: 0, level: 1, storedCoins: 0, storedLevel: 1 })
  await page.screenshot({ path: 'test-results/second-counter-phone-built-shop.png' })

  await page.reload()
  await setSafeArea(page)
  shop = await openStore(page)
  card = shop.locator('[data-upgrade-card="second-counter"]')
  await expect(card).toHaveAttribute('data-level', '1')
  await expect(card.locator('[data-upgrade="second-counter"]')).toHaveText('BUILT')
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().save.coins)).toBe(0)

  for (const size of PHONES) {
    await page.setViewportSize(size)
    await setSafeArea(page)
    await expectShopFits(page, card, SAFE_TOP, SAFE_BOTTOM)
    await expectNoDocumentScroll(page)
    await page.screenshot({ path: `test-results/second-counter-${size.name}-shop.png` })
    await shop.locator('[data-action="back"]').click()
    await expect(shop).not.toBeVisible()
    await expectDockFits(page, SAFE_BOTTOM)
    await expectNoDocumentScroll(page)
    shop = await openStore(page)
    card = shop.locator('[data-upgrade-card="second-counter"]')
  }

  const worker = await page.evaluate(async () => (await fetch('/sw.js')).text())
  expect(worker).toContain("const CACHE = 'scoopaloo-v17'")
  expect(worker).not.toContain('second-counter')
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().skin.counterExpansion?.station.sprite)).toEqual([3, 2])

  for (const size of [
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size)
    await setSafeArea(page, 0, 0)
    await expectShopFits(page, card, 0, 0)
    await expectNoDocumentScroll(page)
    await page.screenshot({ path: `test-results/second-counter-${size.name}-shop.png` })
  }
})

test('a held pointer prepares and drops at both physical counters into the shared inventory', async ({ page }) => {
  test.setTimeout(120_000)
  await seed(page, completedSave(1))
  await page.goto('/')
  await setSafeArea(page)
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())

  await pointerPrepareAndDrop(page, 'primary', 'test-results/second-counter-pointer-primary.png')
  await page.reload()
  await setSafeArea(page)
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
  await pointerPrepareAndDrop(page, 'secondary', 'test-results/second-counter-pointer-secondary.png')
})

test('level zero keeps one lane while the built counter serves both lanes concurrently at their own coordinates', async ({ page }) => {
  await seed(page, completedSave(0))
  await page.goto('/')
  await page.evaluate(() => {
    window.__scoopaloo.pause(true)
    window.__scoopaloo.startShift()
    window.__scoopaloo.advance(2.05)
    const waiting = window.__scoopaloo.snapshot().customers.filter(customer => !customer.served && !customer.missed).slice(0, 2)
    window.__scoopaloo.stockCounter(waiting.reduce<Record<string, number>>((items, customer) => {
      items[customer.order.item] = (items[customer.order.item] ?? 0) + customer.order.quantity
      return items
    }, {}))
    window.__scoopaloo.advance(.71)
    window.__scoopaloo.advance(.71)
  })

  const legacy = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    return {
      served: state.shift.served,
      secondary: state.secondaryCounter,
      pay: state.events.filter(event => event.kind === 'pay').map(event => [event.x, event.y]),
      primary: state.skin.stations.register.interaction,
    }
  })
  expect(legacy.served).toBe(2)
  expect(legacy.secondary).toEqual({ serveTimer: 0, servingCustomerId: null })
  expect(legacy.pay).toEqual([legacy.primary, legacy.primary])

  await replaceSave(page, completedSave(1))
  await setSafeArea(page)
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(true)
    game.startShift()
    game.advance(2.05)
    const waiting = game.snapshot().customers.filter(customer => !customer.served && !customer.missed).slice(0, 2)
    game.stockCounter(waiting.reduce<Record<string, number>>((items, customer) => {
      items[customer.order.item] = (items[customer.order.item] ?? 0) + customer.order.quantity
      return items
    }, {}))
    game.advance(.35)
    game.movePlayer({ x: 905, y: 600 })
  })
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

  const concurrent = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const waiting = state.customers.filter(customer => !customer.served && !customer.missed).slice(0, 2)
    const view = window.__scoopaloo.viewport()
    const clientRect = (left: number, top: number, right: number, bottom: number) => ({
      left: (left - view.originX) * view.scale,
      top: (top - view.originY) * view.scale,
      right: (right - view.originX) * view.scale,
      bottom: (bottom - view.originY) * view.scale,
    })
    const [x, y, width, height] = state.skin.counterExpansion!.station.draw
    const [primaryX, primaryY, primaryWidth, primaryHeight] = state.skin.stations.counter.draw
    const primary = waiting.find(customer => customer.id % 2 === 1)!
    const secondary = waiting.find(customer => customer.id % 2 === 0)!
    const station = clientRect(x, y, x + width, y + height)
    const primaryStation = clientRect(primaryX, primaryY, primaryX + primaryWidth, primaryY + primaryHeight)
    const primaryCustomer = clientRect(primary.x - 58, primary.y - 125, primary.x + 58, primary.y + 10)
    const customer = clientRect(secondary.x - 58, secondary.y - 125, secondary.x + 58, secondary.y + 10)
    const inside = (rect: ReturnType<typeof clientRect>) => rect.left >= 0 && rect.top >= 0
      && rect.right <= innerWidth && rect.bottom <= innerHeight
    return {
      ids: waiting.map(customer => customer.id),
      primary: state.counter,
      secondary: state.secondaryCounter,
      inventory: state.counter.items,
      expectedInventory: waiting.reduce<Record<string, number>>((items, target) => {
        items[target.order.item] = (items[target.order.item] ?? 0) + target.order.quantity
        return items
      }, {}),
      east: Math.abs(view.originX - (960 - view.viewWidth)) < .001,
      station,
      primaryStation,
      primaryCustomer,
      customer,
      stationInside: inside(station),
      primaryStationInside: inside(primaryStation),
      primaryCustomerInside: inside(primaryCustomer),
      customerInside: inside(customer),
    }
  })
  expect(concurrent.ids).toEqual([1, 2])
  expect(concurrent.primary.servingCustomerId).toBe(1)
  expect(concurrent.secondary.servingCustomerId).toBe(2)
  expect(concurrent.primary.serveTimer).toBeCloseTo(.35, 5)
  expect(concurrent.secondary.serveTimer).toBeCloseTo(.35, 5)
  for (const [item, quantity] of Object.entries(concurrent.expectedInventory)) {
    expect(concurrent.inventory[item]).toBe(quantity)
  }
  expect(concurrent.east
    && concurrent.primaryStationInside && concurrent.stationInside
    && concurrent.primaryCustomerInside && concurrent.customerInside).toBe(true)
  await page.screenshot({ path: 'test-results/second-counter-concurrent-east.png' })

  await page.evaluate(() => window.__scoopaloo.advance(.36))
  const settled = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    return {
      served: state.shift.served,
      timers: [state.counter, state.secondaryCounter].map(counter => ({
        timer: counter.serveTimer,
        target: counter.servingCustomerId,
      })),
      pay: state.events.filter(event => event.kind === 'pay').map(event => ({
        item: event.item,
        point: [event.x, event.y],
        amount: event.amount,
      })),
      primary: state.skin.stations.register.interaction,
      secondary: state.skin.counterExpansion!.station.interaction,
      coins: state.flyingCoins.length,
    }
  })
  expect(settled.served).toBe(2)
  expect(settled.timers).toEqual([{ timer: 0, target: null }, { timer: 0, target: null }])
  expect(settled.pay).toHaveLength(2)
  expect(settled.pay.map(event => event.point)).toEqual([settled.primary, settled.secondary])
  expect(settled.pay.every(event => event.item && Number(event.amount) > 0)).toBe(true)
  expect(settled.coins).toBe(8)
})
