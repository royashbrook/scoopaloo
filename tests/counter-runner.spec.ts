import { expect, test, type Locator, type Page } from '@playwright/test'
import { defaultSave, type SaveV1 } from '../src/engine'
import { MOTION_TIMES } from '../src/render'
import { encodeSave, SAVE_KEY } from '../src/save'
import type { GameSkin } from '../src/skin'
import skinData from '../src/skins/ice-cream.json' with { type: 'json' }

const SKIN = skinData as GameSkin
const SAFE_TOP = 59
const SAFE_BOTTOM = 34
const PHONE = { width: 390, height: 844 }
const VIEWPORTS = [
  { name: 'iphone-375', width: 375, height: 812, top: SAFE_TOP, bottom: SAFE_BOTTOM },
  { name: 'phone-390', width: 390, height: 844, top: SAFE_TOP, bottom: SAFE_BOTTOM },
  { name: 'iphone-air', width: 420, height: 912, top: SAFE_TOP, bottom: SAFE_BOTTOM },
  { name: 'tablet', width: 768, height: 1024, top: 0, bottom: 0 },
  { name: 'desktop', width: 1440, height: 900, top: 0, bottom: 0 },
] as const
type Point = { x: number; y: number }
let replacementSerial = 0

test.use({ viewport: PHONE, hasTouch: true, reducedMotion: 'reduce' })

function staffSave(
  runner: 0 | 1 | 2 | 3,
  coins = 0,
  built: 0 | 1 = 1,
  rush = false,
  helper: 0 | 1 | 2 | 3 = 0,
): SaveV1 {
  const save = defaultSave(SKIN)
  return {
    ...save,
    coins,
    lifetimeCash: Math.max(coins, 190),
    currentDay: 2,
    unlockedStations: [...new Set([...save.unlockedStations, 'chocolate-scoop'])],
    upgrades: {
      ...save.upgrades,
      shoes: 3,
      tray: 0,
      machine: 0,
      patience: 3,
      helper,
      'second-counter': built,
      'counter-runner': runner,
    },
    bestRevenue: 190,
    bestStars: 3,
    dayStars: [3, 3, 3],
    dayBestRevenue: [90, 140, 190],
    scoreChaseLevel: rush ? 1 : 0,
    scoreChaseBest: rush ? 140 : 0,
  }
}

async function seed(page: Page, save: SaveV1): Promise<void> {
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value))
  }, { key: SAVE_KEY, value: save })
}

async function replaceSave(page: Page, save: SaveV1): Promise<void> {
  const marker = `scoopaloo.runner.replace.${++replacementSerial}`
  await page.addInitScript(({ key, value, markerKey }) => {
    if (sessionStorage.getItem(markerKey) !== '1') return
    localStorage.setItem(key, JSON.stringify(value))
    sessionStorage.removeItem(markerKey)
  }, { key: SAVE_KEY, value: save, markerKey: marker })
  await page.evaluate(markerKey => sessionStorage.setItem(markerKey, '1'), marker)
  await page.reload()
}

async function setSafeArea(page: Page, top = SAFE_TOP, bottom = SAFE_BOTTOM): Promise<void> {
  await page.evaluate(({ safeTop, safeBottom }) => {
    document.documentElement.style.setProperty('--safe-top', `${safeTop}px`)
    document.documentElement.style.setProperty('--safe-bottom', `${safeBottom}px`)
    dispatchEvent(new Event('resize'))
  }, { safeTop: top, safeBottom: bottom })
  await repaint(page)
}

async function repaint(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function mouseClick(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('pointer target has no box')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

async function openStore(page: Page): Promise<Locator> {
  await mouseClick(page, page.locator('#store-button'))
  const shop = page.getByRole('dialog', { name: 'UPGRADE SHOP' })
  await expect(shop).toBeVisible()
  return shop
}

async function expectNoDocumentScroll(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement
    return {
      client: [root.clientWidth, root.clientHeight],
      scroll: [root.scrollWidth, root.scrollHeight],
      position: [scrollX, scrollY],
      viewport: [innerWidth, innerHeight],
    }
  })
  expect(report.client).toEqual(report.viewport)
  expect(report.scroll).toEqual(report.viewport)
  expect(report.position).toEqual([0, 0])
}

async function expectStoreFits(page: Page, card: Locator, safeTop: number, safeBottom: number): Promise<void> {
  await card.scrollIntoViewIfNeeded()
  const report = await card.evaluate((target, safe) => {
    const dialog = target.closest<HTMLDialogElement>('.shop-card')!
    const button = target.querySelector('button')!
    const box = (element: Element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
      return { left, top, right, bottom, width, height }
    }
    const dialogBox = box(dialog)
    const cardBox = box(target)
    const action = box(button)
    const inside = (rect: ReturnType<typeof box>) => rect.left >= 0 && rect.right <= innerWidth
      && rect.top >= safe.safeTop && rect.bottom <= innerHeight - safe.safeBottom
    const copy = [...target.querySelectorAll<HTMLElement>('h2, p, small, strong, button')]
      .filter(element => getComputedStyle(element).display !== 'none')
      .map(element => ({
        text: element.textContent?.trim(),
        font: Number.parseFloat(getComputedStyle(element).fontSize),
        fits: element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
      }))
    return {
      dialogInside: inside(dialogBox),
      cardInside: inside(cardBox),
      actionInside: inside(action),
      actionHeight: action.height,
      noScroll: dialog.scrollWidth <= dialog.clientWidth + 1 && dialog.scrollHeight <= dialog.clientHeight + 1,
      copy,
    }
  }, { safeTop, safeBottom })
  expect(report.dialogInside && report.cardInside && report.actionInside, JSON.stringify(report)).toBe(true)
  expect(report.actionHeight).toBeGreaterThanOrEqual(44)
  expect(report.noScroll, JSON.stringify(report)).toBe(true)
  expect(report.copy.filter(item => !item.fits), JSON.stringify(report)).toEqual([])
  expect(Math.min(...report.copy.map(item => item.font))).toBeGreaterThanOrEqual(13)
  await expectNoDocumentScroll(page)
}

function sequenceCount(values: number[], sequence: number[]): number {
  return values.reduce((total, _, index) => total
    + Number(sequence.every((value, offset) => values[index + offset] === value)), 0)
}

async function installSoundTrace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frequencies: number[] = []
    Object.defineProperty(window, '__runnerFrequencies', { configurable: true, value: frequencies })
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
}

async function installRunnerTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Trace = { draws: number[][]; labels: string[]; flights: number[][] }
    const target = window as Window & { __runnerTrace?: Trace }
    const context = document.querySelector('canvas')!.getContext('2d')!
    const runner = window.__scoopaloo.snapshot().skin.counterRunner!
    const [column, row] = runner.sprite
    const runnerCrop = window.__scoopaloo.snapshot().skin.spriteRects[row][column].join(',')
    const trace: Trace = { draws: [], labels: [], flights: [] }
    target.__runnerTrace = trace
    const drawImage = context.drawImage.bind(context) as (...args: unknown[]) => void
    const fillText = context.fillText.bind(context)
    const clearRect = context.clearRect.bind(context)
    Object.defineProperty(context, 'drawImage', {
      configurable: true,
      value: (...args: unknown[]) => {
        const numbers = args.slice(1).map(Number)
        if (numbers.slice(0, 4).join(',') === runnerCrop
          && numbers.slice(-4).join(',') === '0,0,64,78') trace.draws.push([...runner.draw])
        if (numbers.slice(-4).join(',') === '-17,-20,34,40') {
          const { a, b, c, d, e, f } = context.getTransform()
          trace.flights.push([a, b, c, d, e, f])
        }
        drawImage(...args)
      },
    })
    Object.defineProperty(context, 'fillText', {
      configurable: true,
      value: (text: string, ...args: [number, number, number?]) => {
        if (text.startsWith('MEL ·')) trace.labels.push(text)
        fillText(text, ...args)
      },
    })
    Object.defineProperty(context, 'clearRect', {
      configurable: true,
      value: (x: number, y: number, width: number, height: number) => {
        trace.draws.length = 0
        trace.labels.length = 0
        trace.flights.length = 0
        clearRect(x, y, width, height)
      },
    })
  })
}

async function installWrongFeedbackTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const values: string[] = []
    Object.defineProperty(window, '__runnerWrongFeedback', { configurable: true, value: values })
    const target = document.querySelector<HTMLElement>('[data-field="ticket-guidance"]')!
    const record = () => { if (target.textContent?.includes('WRONG ITEM')) values.push(target.textContent) }
    new MutationObserver(record).observe(target, { childList: true, subtree: true, characterData: true })
    record()
  })
}

async function winCurrentShift(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(true)
    if (game.snapshot().phase === 'ready') game.startShift()
    for (let tick = 0; tick < 300 && game.snapshot().phase === 'playing'; tick++) {
      const state = game.snapshot()
      if (state.shift.revenue >= state.rules.cashGoal) {
        game.advance(state.shift.remaining)
        break
      }
      const front = state.customers.find(customer => !customer.served && !customer.missed)
      if (!front) {
        game.advance(.5)
        continue
      }
      game.stockCounter({ [front.order.item]: front.order.quantity })
      const point = front.id % 2 === 1
        ? state.skin.stations.register.interaction
        : state.skin.counterExpansion!.station.interaction
      game.movePlayer({ x: point[0], y: point[1] })
      game.advance(.75)
      game.advance(1.25)
    }
    if (game.snapshot().phase === 'playing') throw new Error('shift win watchdog expired')
  })
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().phase)).toBe('results')
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
      if (next.distance < 12) {
        await stop()
        return
      }
      if (next.phase !== 'playing') throw new Error(`shift ended before reaching ${target.x},${target.y}`)
      await page.mouse.move(origin.x + next.dx / next.distance * 60, origin.y + next.dy / next.distance * 60)
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

async function collectFrom(page: Page, move: (target: Point) => Promise<void>, item: string): Promise<void> {
  const source = await page.evaluate(id => {
    const state = window.__scoopaloo.snapshot()
    const station = Object.values(state.skin.producers).find(candidate => candidate.item === id)!
    return {
      before: state.player.trayItems[id] ?? 0,
      player: { x: state.player.x, y: state.player.y },
      point: { x: station.interaction[0], y: station.interaction[1] },
    }
  }, item)
  // The four pickup rings bracket the direct diagonals. Use the open wall lane
  // so a real drag cannot accidentally fill the two-slot tray on the way.
  const currentLane = source.player.x > 600 ? 770 : 380
  const targetLane = source.point.x > 600 ? 770 : 380
  await move({ x: currentLane, y: source.player.y })
  await move({ x: currentLane, y: 400 })
  await move({ x: targetLane, y: 400 })
  await move({ x: targetLane, y: source.point.y })
  await move(source.point)
  await expect.poll(() => page.evaluate(id => window.__scoopaloo.snapshot().player.trayItems[id] ?? 0, item), {
    timeout: 5_000,
  }).toBe(source.before + 1)
}

async function expectRunnerPlayFits(page: Page, safeTop: number, safeBottom: number): Promise<void> {
  const report = await page.evaluate(({ top, bottom }) => {
    const state = window.__scoopaloo.snapshot()
    const runner = state.skin.counterRunner!
    const view = window.__scoopaloo.viewport()
    const map = ([x, y]: number[]) => ({ x: (x - view.originX) * view.scale, y: (y - view.originY) * view.scale })
    const worldBox = ([x, y, width, height]: number[]) => {
      const leftTop = map([x, y])
      const rightBottom = map([x + width, y + height])
      return { left: leftTop.x, top: leftTop.y, right: rightBottom.x, bottom: rightBottom.y }
    }
    const domBox = (selector: string) => {
      const { left, top, right, bottom } = document.querySelector(selector)!.getBoundingClientRect()
      return { left, top, right, bottom }
    }
    const inside = (box: ReturnType<typeof worldBox>) => box.left >= 0 && box.right <= innerWidth
      && box.top >= top && box.bottom <= innerHeight - bottom
    const overlaps = (a: ReturnType<typeof worldBox>, b: ReturnType<typeof worldBox>) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const draw = worldBox(runner.draw)
    const status = worldBox(runner.status)
    const chrome = [domBox('.shift-hud'), domBox('.order-panel')]
    return {
      draw,
      status,
      inside: inside(draw) && inside(status),
      chromeClear: chrome.every(box => !overlaps(draw, box) && !overlaps(status, box)),
      describedBy: document.querySelector('canvas')!.getAttribute('aria-describedby'),
    }
  }, { top: safeTop, bottom: safeBottom })
  expect(report.inside, JSON.stringify(report)).toBe(true)
  expect(report.chromeClear, JSON.stringify(report)).toBe(true)
  expect(report.describedBy).toBe('helper-status runner-status')
  await expectNoDocumentScroll(page)
}

async function expectPhoneEmptyInventoryFits(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const inventory = document.querySelector<HTMLElement>('.inventory-readout.is-empty')!
    const recipe = document.querySelector<HTMLElement>('.recipe-list')!
    const ticket = document.querySelector<HTMLElement>('.order-ticket')!
    const pseudo = getComputedStyle(inventory, '::after')
    const box = (element: Element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
      return { left, top, right, bottom, width, height }
    }
    const inventoryBox = box(inventory)
    const recipeBox = box(recipe)
    const ticketBox = box(ticket)
    const canvas = document.createElement('canvas').getContext('2d')!
    canvas.font = pseudo.font
    const padding = Number.parseFloat(pseudo.paddingLeft) + Number.parseFloat(pseudo.paddingRight)
    const widest = Math.max(canvas.measureText('TRAY + COUNTER').width, canvas.measureText('EMPTY').width)
    const lineHeight = Number.parseFloat(pseudo.lineHeight)
    return {
      content: pseudo.content,
      whiteSpace: pseudo.whiteSpace,
      font: Number.parseFloat(pseudo.fontSize),
      lineHeight,
      lineFits: widest <= inventoryBox.width - padding + 1,
      heightFits: lineHeight * 2 <= inventoryBox.height + 1,
      containersClear: recipeBox.right <= inventoryBox.left + 1,
      insideTicket: recipeBox.left >= ticketBox.left && inventoryBox.right <= ticketBox.right
        && recipeBox.top >= ticketBox.top && inventoryBox.bottom <= ticketBox.bottom,
    }
  })
  expect(report.content).toContain('TRAY + COUNTER')
  expect(report.content).toContain('EMPTY')
  expect(report).toMatchObject({
    whiteSpace: 'pre-line',
    font: 13,
    lineFits: true,
    heightFits: true,
    containersClear: true,
    insideTicket: true,
  })
}

test('MEL is gated, uses HIRE/TRAIN, survives offline rescue and the Day 3 to Rush transition', async ({ context, page }) => {
  test.setTimeout(120_000)
  await installSoundTrace(page)
  await seed(page, staffSave(0, 300, 0))
  await page.goto('/')
  await setSafeArea(page)

  let shop = await openStore(page)
  let card = shop.locator('[data-upgrade-card="counter-runner"]')
  await expect(card).toHaveCount(0)
  const helperCard = shop.locator('[data-upgrade-card="helper"]')
  await expect(helperCard.getByRole('button')).toHaveText('HIRE $180')
  await expectStoreFits(page, helperCard, SAFE_TOP, SAFE_BOTTOM)
  await page.screenshot({ path: 'test-results/counter-runner-phone-hidden.png' })

  await replaceSave(page, staffSave(0, 1_900))
  await setSafeArea(page)
  shop = await openStore(page)
  card = shop.locator('[data-upgrade-card="counter-runner"]')
  await expect(card).toHaveAttribute('data-available', 'true')
  await expect(card.locator('.helper-description')).toHaveText('MOVES FINISHED ORDERS.')
  const soundsAtPurchase = await page.evaluate(() =>
    (window as unknown as { __runnerFrequencies: number[] }).__runnerFrequencies.length)
  for (const [level, label, status] of [
    [1, 'HIRE $300', 'MEL hired. Moves finished orders to the shared counter every 15 seconds.'],
    [2, 'TRAIN $600', 'MEL trained. Moves finished orders to the shared counter every 10 seconds.'],
    [3, 'TRAIN $1000', 'MEL trained. Moves finished orders to the shared counter every 7.5 seconds.'],
  ] as const) {
    await expect(card.getByRole('button')).toHaveText(label)
    await mouseClick(page, card.getByRole('button'))
    await expect(card).toHaveAttribute('data-level', String(level))
    await expect(page.locator('[data-field="purchase-status"]')).toHaveText(status)
  }
  await expect(card.getByRole('button')).toHaveText('MAX LEVEL')
  await expect(card.getByRole('button')).toBeDisabled()
  const purchaseSounds = await page.evaluate(start =>
    (window as unknown as { __runnerFrequencies: number[] }).__runnerFrequencies.slice(start), soundsAtPurchase)
  expect(sequenceCount(purchaseSounds, [660, 880])).toBe(3)
  expect(await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const stored = JSON.parse(localStorage.getItem('scoopaloo_save_v1')!) as SaveV1
    return {
      coins: state.save.coins,
      level: state.save.upgrades['counter-runner'],
      storedCoins: stored.coins,
      storedLevel: stored.upgrades['counter-runner'],
    }
  })).toEqual({ coins: 0, level: 3, storedCoins: 0, storedLevel: 3 })

  for (const size of VIEWPORTS) {
    await page.setViewportSize(size)
    await setSafeArea(page, size.top, size.bottom)
    await expectStoreFits(page, card, size.top, size.bottom)
    await page.screenshot({ path: `test-results/counter-runner-${size.name}-shop.png` })
  }

  await page.reload()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().save.upgrades['counter-runner'])).toBe(3)
  await context.setOffline(false)

  const saved = await page.evaluate(() => window.__scoopaloo.snapshot().save)
  const rescue = await encodeSave(saved)
  await page.goto(`/rescue.html#${rescue}`)
  await mouseClick(page, page.getByRole('button', { name: 'RESTORE SAVE' }))
  await expect(page.getByText('SAVE RESTORED')).toBeVisible()
  await mouseClick(page, page.getByRole('link', { name: 'PLAY SCOOPALOO' }))
  await page.waitForURL(url => url.pathname === '/')
  await page.waitForFunction(() => '__scoopaloo' in window)
  await expect.poll(() => page.evaluate(() => window.__scoopaloo?.snapshot().save.upgrades['counter-runner'] ?? -1)).toBe(3)

  await winCurrentShift(page)
  await expect(page.getByRole('heading', { name: 'SHIFT COMPLETE' })).toBeVisible()
  shop = await openStore(page)
  await expect(shop.locator('[data-upgrade-card="counter-runner"] button')).toHaveText('MAX LEVEL')
  await mouseClick(page, shop.locator('[data-action="next"]'))
  expect(await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    return { phase: state.phase, rush: state.save.scoreChaseLevel, runner: state.save.upgrades['counter-runner'] }
  })).toEqual({ phase: 'ready', rush: 1, runner: 3 })

  await mouseClick(page, page.locator('#play-button'))
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(true)
    game.advance(game.snapshot().shift.remaining)
    game.retryShift()
  })
  expect(await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    return { phase: state.phase, runner: state.save.upgrades['counter-runner'], remaining: state.counterRunner.remaining }
  })).toEqual({ phase: 'playing', runner: 3, remaining: 7.5 })
})

test('browser state exposes exact 15/10/7.5 cadence, READY without catch-up, and idle staff earn $0', async ({ page }) => {
  await seed(page, staffSave(1, 0, 1, true))
  await page.goto('/')
  await installRunnerTrace(page)

  for (const [level, interval] of [[1, 15], [2, 10], [3, 7.5]] as const) {
    if (level > 1) await replaceSave(page, staffSave(level, 0, 1, true))
    const receipt = await page.evaluate(seconds => {
      const game = window.__scoopaloo
      game.pause(true)
      game.startShift()
      const initial = game.snapshot().counterRunner.remaining
      game.advance(seconds - .05)
      const before = game.snapshot().counterRunner.remaining
      game.advance(.06)
      const ready = game.snapshot()
      game.advance(seconds * 2)
      const later = game.snapshot()
      return {
        initial,
        before,
        ready: ready.counterRunner.remaining,
        later: later.counterRunner.remaining,
        drops: later.events.filter(event => event.kind === 'drop' && event.source === 'counter-runner').length,
        counter: later.counter.stock,
        outputs: Object.values(later.prepStations).reduce((sum, prep) =>
          sum + Object.values(prep.outputs).reduce((total, quantity) => total + quantity, 0), 0),
      }
    }, interval)
    expect(receipt.initial).toBe(interval)
    expect(receipt.before).toBeCloseTo(.05, 5)
    expect(receipt).toMatchObject({ ready: 0, later: 0, drops: 0, counter: 0, outputs: 0 })
    await repaint(page)
    await expect(page.locator('#runner-status')).toHaveText('MEL is ready for a finished order.')
    if (level === 1) {
      expect(await page.evaluate(() => {
        const trace = (window as Window & { __runnerTrace?: { draws: number[][]; labels: string[] } }).__runnerTrace
        return trace
      })).toMatchObject({ draws: [SKIN.counterRunner!.draw], labels: ['MEL · READY'] })
      await page.screenshot({ path: 'test-results/counter-runner-phone-ready.png' })
    }
  }

  await replaceSave(page, staffSave(3, 0, 0, true))
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(true)
    game.startShift()
    game.advance(30)
  })
  expect(await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    return { remaining: state.counterRunner.remaining, counter: state.counter.stock, coins: state.save.coins }
  })).toEqual({ remaining: 0, counter: 0, coins: 0 })
  await expect(page.locator('#runner-status')).toHaveText('')
  await expect(page.locator('canvas')).toHaveAttribute('aria-describedby', 'helper-status')

  await replaceSave(page, staffSave(3, 0, 1, true, 3))
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(true)
    game.startShift()
    game.advance(game.snapshot().shift.remaining)
  })
  expect(await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    return { phase: state.phase, revenue: state.shift.revenue, coins: state.save.coins }
  })).toEqual({ phase: 'results', revenue: 0, coins: 0 })
})

test('a real phone pointer hires MEL, leaves a finished order, transfers once, and collects the exact payout', async ({ page }) => {
  test.setTimeout(150_000)
  await installSoundTrace(page)
  await seed(page, staffSave(0, 300, 1, true))
  await page.goto('/')
  await setSafeArea(page)
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
  await installWrongFeedbackTrace(page)

  const shop = await openStore(page)
  const card = shop.locator('[data-upgrade-card="counter-runner"]')
  await expect(card.getByRole('button')).toHaveText('HIRE $300')
  await mouseClick(page, card.getByRole('button'))
  await expect(card).toHaveAttribute('data-level', '1')
  await expect(page.locator('[data-field="purchase-status"]')).toHaveText(
    'MEL hired. Moves finished orders to the shared counter every 15 seconds.',
  )
  await mouseClick(page, shop.locator('[data-action="back"]'))
  await mouseClick(page, page.locator('#play-button'))
  await installRunnerTrace(page)

  await page.evaluate(() => window.__scoopaloo.pause(true))
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size)
    await setSafeArea(page, size.top, size.bottom)
    await page.evaluate(() => window.__scoopaloo.movePlayer({ x: 850, y: 850 }))
    await repaint(page)
    await expectRunnerPlayFits(page, size.top, size.bottom)
    if (size.width <= 420) await expectPhoneEmptyInventoryFits(page)
    await page.screenshot({ path: `test-results/counter-runner-${size.name}-playing.png` })
  }
  await page.setViewportSize(PHONE)
  await setSafeArea(page)
  await page.evaluate(() => {
    window.__scoopaloo.movePlayer({ x: 480, y: 880 })
    window.__scoopaloo.pause(false)
  })

  const route = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const front = state.customers.find(customer => !customer.served && !customer.missed)!
    const recipe = state.skin.items[front.order.item].recipe!
    const inputs = Object.entries(recipe.inputs).flatMap(([item, count]) => Array<string>(count).fill(item))
    const raw = Object.keys(state.skin.items).filter(item => !state.skin.items[item].recipe)
    const fillers = raw.filter(item => !inputs.includes(item)).slice(0, 2)
    const prep = state.skin.prepStations[recipe.station].interaction
    return {
      customer: front.id,
      item: front.order.item,
      quantity: front.order.quantity,
      price: front.order.price,
      inputs,
      fillers,
      station: recipe.station,
      prep: { x: prep[0], y: prep[1] },
    }
  })
  expect(route).toMatchObject({ item: 'chocolate-cone', quantity: 1, price: 12 })

  await withHeldJoystick(page, async move => {
    for (const item of route.inputs) await collectFrom(page, move, item)
    await move(route.prep)
    await expect.poll(() => page.evaluate(({ station, item }) =>
      window.__scoopaloo.snapshot().prepStations[station].job?.item === item, route), { timeout: 3_000 }).toBe(true)
    for (const item of route.fillers) await collectFrom(page, move, item)
  })
  expect(await page.evaluate(station => {
    const state = window.__scoopaloo.snapshot()
    return {
      tray: state.player.tray,
      job: state.prepStations[station].job?.item,
      output: state.prepStations[station].outputs,
    }
  }, route.station)).toMatchObject({ tray: 2, job: route.item })

  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().counterRunner.remaining), {
    timeout: 20_000,
  }).toBe(0)
  await repaint(page)
  await expect(page.locator('#runner-status')).toHaveText('MEL is ready for a finished order.')
  expect(await page.evaluate(() =>
    (window as Window & { __runnerTrace?: { labels: string[] } }).__runnerTrace?.labels)).toContain('MEL · READY')
  await page.screenshot({ path: 'test-results/counter-runner-phone-ready-physical.png' })

  const soundsBeforeTransfer = await page.evaluate(() =>
    (window as unknown as { __runnerFrequencies: number[] }).__runnerFrequencies.length)
  await withHeldJoystick(page, async move => { await move(route.prep) })
  await page.waitForFunction(item => window.__scoopaloo.snapshot().events.some(event =>
    event.kind === 'drop' && event.source === 'counter-runner' && event.item === item), route.item, { timeout: 6_000 })
  await page.evaluate(() => window.__scoopaloo.pause(true))

  const transfer = await page.evaluate(({ item, station }) => {
    const state = window.__scoopaloo.snapshot()
    const event = [...state.events].reverse().find(candidate =>
      candidate.kind === 'drop' && candidate.source === 'counter-runner' && candidate.item === item)!
    return {
      prep: state.prepStations[station].outputs[item] ?? 0,
      counter: state.counter.items[item] ?? 0,
      stock: state.counter.stock,
      remaining: state.counterRunner.remaining,
      event: { x: event.x, y: event.y, from: event.from, station: event.station, createdAt: event.createdAt },
      expectedFrom: state.skin.prepStations[station].interaction,
      expectedAt: state.skin.counterExpansion!.station.interaction,
      negative: [
        ...Object.values(state.counter.items),
        ...Object.values(state.player.trayItems),
        ...Object.values(state.prepStations).flatMap(prep => Object.values(prep.outputs)),
      ].some(value => value < 0),
    }
  }, route)
  expect(transfer).toMatchObject({ prep: 0, counter: 1, stock: 1, negative: false })
  expect(transfer.remaining).toBeGreaterThan(14.8)
  expect(transfer.event).toMatchObject({
    x: transfer.expectedAt[0],
    y: transfer.expectedAt[1],
    from: { x: transfer.expectedFrom[0], y: transfer.expectedFrom[1] },
    station: route.station,
  })

  await page.evaluate(() => window.__scoopaloo.movePlayer({ x: 850, y: 850 }))
  await page.evaluate(time => window.__scoopaloo.setTime(time), transfer.event.createdAt + MOTION_TIMES.DROP_APEX)
  await repaint(page)
  const reducedTransfer = await page.evaluate(() =>
    (window as Window & { __runnerTrace?: { flights: number[][] } }).__runnerTrace?.flights ?? [])
  expect(reducedTransfer).toHaveLength(1)
  expect(reducedTransfer[0].every(Number.isFinite)).toBe(true)
  await page.screenshot({ path: 'test-results/counter-runner-phone-transfer-reduced.png' })

  await page.evaluate(() => window.__scoopaloo.pause(false))
  await page.waitForFunction(item => window.__scoopaloo.snapshot().events.some(event =>
    event.kind === 'pay' && event.item === item), route.item, { timeout: 4_000 })
  await page.evaluate(() => window.__scoopaloo.pause(true))
  const pay = await page.evaluate(({ item, customer }) => {
    const state = window.__scoopaloo.snapshot()
    const target = state.customers.find(candidate => candidate.id === customer)!
    const event = [...state.events].reverse().find(candidate => candidate.kind === 'pay' && candidate.item === item)!
    const patienceUpgrade = state.skin.upgrades.find(upgrade => upgrade.kind === 'customerPatience')!
    const patienceLevel = state.save.upgrades[patienceUpgrade.id] ?? 0
    const patienceMaximum = state.rules.customerPatience + (patienceUpgrade.levels[patienceLevel - 1]?.effect ?? 0)
    const expectedTip = Math.ceil(Math.max(0, Math.min(1, target.patience / patienceMaximum)) * 3)
    const expectedCombo = state.skin.comboTiers.reduce((bonus, tier) =>
      (event.streak ?? 0) >= tier.streak ? tier.bonus : bonus, 0)
    return {
      amount: event.amount!,
      tip: event.tip!,
      combo: event.combo!,
      expectedTip,
      expectedCombo,
      point: { x: event.x, y: event.y },
      served: target.served,
    }
  }, route)
  expect(pay).toMatchObject({
    amount: route.price + pay.expectedTip + pay.expectedCombo,
    tip: pay.expectedTip,
    combo: pay.expectedCombo,
    served: true,
  })

  await page.evaluate(() => window.__scoopaloo.pause(false))
  await withHeldJoystick(page, async move => { await move(pay.point) })
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().save.coins), { timeout: 5_000 }).toBe(pay.amount)
  await page.evaluate(() => window.__scoopaloo.pause(true))
  const final = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    return {
      coins: state.save.coins,
      revenue: state.shift.revenue,
      wrong: (window as unknown as { __runnerWrongFeedback: string[] }).__runnerWrongFeedback,
      frequencies: (window as unknown as { __runnerFrequencies: number[] }).__runnerFrequencies,
      runner: state.counterRunner.remaining,
    }
  })
  expect(final).toMatchObject({ coins: pay.amount, revenue: pay.amount, wrong: [] })
  expect(final.runner).toBeGreaterThan(0)
  expect(final.frequencies.slice(soundsBeforeTransfer)).toEqual(expect.arrayContaining([360, 740, 990]))

  await page.evaluate(() => window.__scoopaloo.pause(false))
  const frameTimes = await page.evaluate(() => new Promise<number[]>(resolve => {
    const samples: number[] = []
    let previous = performance.now()
    const sample = (now: number) => {
      samples.push(now - previous)
      previous = now
      if (samples.length === 75) resolve(samples.slice(5))
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  frameTimes.sort((a, b) => a - b)
  expect(frameTimes[Math.floor(frameTimes.length * .95)]).toBeLessThan(25)
  await page.evaluate(() => window.__scoopaloo.pause(true))
  await page.screenshot({ path: 'test-results/counter-runner-phone-paid.png' })
})
