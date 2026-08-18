import { expect, test, type Page } from '@playwright/test'
import { defaultSave } from '../src/engine'
import { SAVE_KEY } from '../src/save'
import type { GameSkin } from '../src/skin'
import skinData from '../src/skins/ice-cream.json' with { type: 'json' }

const PHONES = [
  { name: 'iphone-375', width: 375, height: 812 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'iphone-air', width: 420, height: 912 },
] as const
const SAFE_TOP = 59
const SAFE_BOTTOM = 34

test.use({ hasTouch: true, reducedMotion: 'reduce' })

async function seedSave(page: Page, helperLevel = 0): Promise<void> {
  const skin = skinData as GameSkin
  const save = defaultSave(skin)
  save.currentDay = 1
  save.unlockedStations = [...new Set([...save.unlockedStations, ...Object.keys(skin.producers)])]
  save.upgrades.helper = helperLevel
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: SAVE_KEY,
    value: save,
  })
}

async function setPhone(page: Page, size: (typeof PHONES)[number]): Promise<void> {
  await page.setViewportSize(size)
  await page.evaluate(({ safeTop, safeBottom }) => {
    document.documentElement.style.setProperty('--safe-top', `${safeTop}px`)
    document.documentElement.style.setProperty('--safe-bottom', `${safeBottom}px`)
    dispatchEvent(new Event('resize'))
  }, { safeTop: SAFE_TOP, safeBottom: SAFE_BOTTOM })
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function freezeReceipt(page: Page): Promise<object> {
  return page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const front = state.customers.find(customer => !customer.served && !customer.missed)
    return {
      time: state.time,
      remaining: state.shift.remaining,
      patience: front?.patience ?? null,
      helper: structuredClone(state.helper),
      player: structuredClone(state.player),
    }
  })
}

async function loadTrayAndCounter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = window.__scoopaloo
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    const collect = (item: string, quantity = 1) => {
      const producer = Object.values(game.snapshot().skin.producers).find(candidate => candidate.item === item)!
      const target = (game.snapshot().player.trayItems[item] ?? 0) + quantity
      game.movePlayer(point(producer.interaction))
      for (let tick = 0; tick < 100 && (game.snapshot().player.trayItems[item] ?? 0) < target; tick++) game.advance(.1)
    }
    game.advance(4)
    collect('soft-scoop')
    collect('chocolate-scoop')
    game.movePlayer({ x: 480, y: 880 })
    game.advance(.05)
    game.stockCounter({ sundae: 1, 'chocolate-sundae': 1 })
  })
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
}

test('phone play uses a legible safe-area order dock without covering the room', async ({ page }) => {
  await seedSave(page)
  await setPhone(page, PHONES[0])
  await page.goto('/')
  await setPhone(page, PHONES[0])
  await page.evaluate(() => {
    window.__scoopaloo.pause(true)
    window.__scoopaloo.startShift()
  })
  await loadTrayAndCounter(page)

  await expect(page.locator('[data-inventory="tray"] img')).toHaveCount(2)
  await expect(page.locator('[data-inventory="counter"] img')).toHaveCount(2)

  for (const size of PHONES) {
    await setPhone(page, size)
    const report = await page.evaluate(({ safeTop, safeBottom }) => {
      const element = (selector: string) => document.querySelector<HTMLElement>(selector)!
      const rect = (selector: string) => {
        const { left, top, right, bottom, width, height } = element(selector).getBoundingClientRect()
        return { left, top, right, bottom, width, height }
      }
      const visible = (candidate: HTMLElement) => {
        const style = getComputedStyle(candidate)
        return style.display !== 'none' && style.visibility !== 'hidden' && candidate.clientWidth > 0
      }
      const leaves = (selectors: string[]) => selectors.flatMap(selector =>
        [...document.querySelectorAll<HTMLElement>(selector)].filter(visible))
      const minFont = (selectors: string[]) => Math.min(...leaves(selectors)
        .map(candidate => Number.parseFloat(getComputedStyle(candidate).fontSize)))
      const fits = (selectors: string[]) => leaves(selectors).map(candidate => ({
        text: candidate.textContent?.trim() ?? '',
        x: candidate.scrollWidth <= candidate.clientWidth + 1,
        y: candidate.scrollHeight <= candidate.clientHeight + 1,
      }))

      const dock = rect('.order-panel')
      const hud = rect('.shift-hud')
      const pause = rect('#pause-button')
      const view = window.__scoopaloo.viewport()
      const state = window.__scoopaloo.snapshot()
      const clientY = (y: number) => (y - view.originY) * view.scale
      const scaleAt = (y: number) => y <= 430 ? .82 : y >= 1030 ? 1.1 : .82 + .28 * ((y - 430) / 600)
      const groundedBottom = (anchorY: number, bottom: number) => clientY(anchorY + (bottom - anchorY) * scaleAt(anchorY))
      const sourceBottoms = Object.entries(state.skin.producers).map(([id, producer]) => {
        const source = state.sources[id]
        const pointY = producer.interaction[1]
        const ringY = Math.min(pointY + 35, 1120 - 40)
        const stockBottom = producer.stockDisplay.origin[1]
          + producer.stockDisplay.step[1] * Math.max(0, (source?.stock ?? 0) - 1)
          + producer.stockDisplay.size[1]
        return groundedBottom(producer.depth, Math.max(producer.draw[1] + producer.draw[3], ringY + 31, stockBottom))
      })
      const prepBottoms = Object.entries(state.skin.prepStations).map(([id, station]) => {
        const outputs = Object.values(state.prepStations[id].outputs).reduce((sum, count) => sum + count, 0)
        const outputBottom = station.outputDisplay.origin[1]
          + station.outputDisplay.step[1] * Math.max(0, outputs - 1)
          + station.outputDisplay.size[1]
        return groundedBottom(station.depth, Math.max(station.draw[1] + station.draw[3], station.interaction[1] + 65, outputBottom))
      })
      const counter = state.skin.stations.counter
      const actorBottoms = [
        groundedBottom(counter.depth, Math.max(counter.draw[1] + counter.draw[3], counter.interaction[1] + 30)),
        groundedBottom(state.player.y, state.player.y + 12),
        ...state.customers.map(customer => groundedBottom(customer.y, customer.y + 10)),
        ...(state.skin.helper ? [groundedBottom(
          state.skin.helper.draw[1] + state.skin.helper.draw[3],
          state.skin.helper.draw[1] + state.skin.helper.draw[3],
        )] : []),
      ]
      const interactionBottom = Math.max(...[
        ...Object.values(state.skin.producers).map(station => clientY(station.interaction[1])),
        ...Object.values(state.skin.prepStations).map(station => clientY(station.interaction[1])),
        ...Object.values(state.skin.stations).map(station => clientY(station.interaction[1])),
      ])
      const orderIcon = element('[data-field="order-icon"]') as HTMLImageElement
      const inventory = element('.inventory-readout')
      const inventoryCells = (['tray', 'counter'] as const).map(name => {
        const target = element(`[data-inventory="${name}"]`)
        const cell = target.parentElement as HTMLElement
        const cellBox = cell.getBoundingClientRect()
        const label = cell.querySelector<HTMLElement>(':scope > span')!
        const parts = [...target.querySelectorAll<HTMLElement>('img, b')].map(part => {
          const box = part.getBoundingClientRect()
          return {
            kind: part.tagName,
            inside: box.left >= cellBox.left && box.top >= cellBox.top
              && box.right <= cellBox.right && box.bottom <= cellBox.bottom,
            edges: {
              left: box.left - cellBox.left,
              top: box.top - cellBox.top,
              right: cellBox.right - box.right,
              bottom: cellBox.bottom - box.bottom,
            },
            font: part.tagName === 'B' ? Number.parseFloat(getComputedStyle(part).fontSize) : null,
          }
        })
        return {
          name,
          types: new Set([...target.querySelectorAll<HTMLImageElement>('img')].map(icon => icon.src)).size,
          fits: target.scrollWidth <= target.clientWidth + 1 && cell.scrollWidth <= cell.clientWidth + 1,
          label: {
            font: Number.parseFloat(getComputedStyle(label).fontSize),
            fits: label.scrollWidth <= label.clientWidth + 1,
          },
          parts,
        }
      })
      return {
        window: { width: innerWidth, height: innerHeight },
        dock,
        hud,
        pause,
        dockBottomGap: innerHeight - safeBottom - dock.bottom,
        clear: {
          dockHud: hud.bottom <= dock.top,
          pauseHud: pause.top >= hud.bottom + 8,
          interactions: interactionBottom <= dock.top,
          sprites: Math.max(...sourceBottoms, ...prepBottoms, ...actorBottoms) <= dock.top,
        },
        content: {
          itemIcon: orderIcon.complete && orderIcon.naturalWidth > 0,
          name: element('[data-field="order-label"]').textContent?.trim(),
          quantity: element('[data-field="order-quantity"]').textContent?.trim(),
          patience: element('[data-field="patience-seconds"]').textContent?.trim(),
          guidance: element('[data-field="ticket-guidance"]').textContent?.trim(),
          counts: [...document.querySelectorAll<HTMLElement>('.recipe-list li')].map(row => row.textContent?.trim() ?? ''),
          tray: element('[data-inventory="tray"]').textContent?.trim(),
          counter: element('[data-inventory="counter"]').textContent?.trim(),
          inventoryEmpty: inventory.classList.contains('is-empty'),
        },
        fonts: {
          primary: Number.parseFloat(getComputedStyle(element('[data-field="order-label"]')).fontSize),
          guidance: Number.parseFloat(getComputedStyle(element('[data-field="ticket-guidance"]')).fontSize),
          secondary: minFont([
            '[data-field="order-quantity"]',
            '[data-field="patience-seconds"]',
            '.recipe-list li',
            '.inventory-readout > div > span',
            '[data-inventory] span',
          ]),
        },
        fit: fits([
          '[data-field="order-label"]',
          '[data-field="order-quantity"]',
          '[data-field="patience-seconds"]',
          '[data-field="ticket-guidance"]',
          '.recipe-list li',
          '.inventory-readout > div',
        ]),
        inventoryCells,
      }
    }, { safeTop: SAFE_TOP, safeBottom: SAFE_BOTTOM })

    expect(report.dock.left, size.name).toBeGreaterThanOrEqual(12)
    expect(report.window.width - report.dock.right, size.name).toBeGreaterThanOrEqual(12)
    expect(report.dock.height, size.name).toBeLessThanOrEqual(132)
    expect(report.dockBottomGap, size.name).toBeCloseTo(8, 0)
    expect(report.hud.top, size.name).toBeGreaterThanOrEqual(SAFE_TOP)
    expect(report.pause, size.name).toMatchObject({ width: 48, height: 48 })
    expect(report.window.width - report.pause.right, size.name).toBeGreaterThanOrEqual(12)
    expect(report.clear, size.name).toEqual({ dockHud: true, pauseHud: true, interactions: true, sprites: true })
    expect(report.content.itemIcon, size.name).toBe(true)
    expect(report.content.name, size.name).toBeTruthy()
    expect(report.content.quantity, size.name).toMatch(/^×[1-9]/)
    expect(report.content.patience, size.name).toMatch(/^\d+s$/)
    expect(report.content.guidance, size.name).toBeTruthy()
    expect(report.content.counts.length, size.name).toBeGreaterThan(0)
    expect(report.content.counts.every(value => /\d+\/\d+/.test(value)), size.name).toBe(true)
    expect(report.content, size.name).toMatchObject({ inventoryEmpty: false })
    expect(report.content.tray, size.name).toBeTruthy()
    expect(report.content.counter, size.name).toBeTruthy()
    expect(report.fonts.primary, size.name).toBeGreaterThanOrEqual(14)
    expect(report.fonts.guidance, size.name).toBeGreaterThanOrEqual(15)
    expect(report.fonts.secondary, size.name).toBeGreaterThanOrEqual(13)
    expect(report.fit.filter(value => !value.x || !value.y), size.name).toEqual([])
    if (size.name === 'iphone-375') {
      expect(report.inventoryCells.map(cell => cell.types)).toEqual([2, 2])
      expect(report.inventoryCells.every(cell => cell.fits && cell.label.fits && cell.label.font >= 13), size.name).toBe(true)
      expect(report.inventoryCells.flatMap(cell => cell.parts)
        .filter(part => !part.inside || part.font !== null && part.font < 13), size.name).toEqual([])
    }
    await page.screenshot({ path: `test-results/pause-dock-${size.name}.png` })
  }
})

test('pause freezes the whole shift, restores focus, and auto-pauses when hidden', async ({ page }) => {
  await seedSave(page, 1)
  await setPhone(page, PHONES[1])
  await page.goto('/')
  await setPhone(page, PHONES[1])
  await page.evaluate(() => { document.querySelector<HTMLButtonElement>('#update-toast')!.hidden = false })
  const updateToast = page.locator('#update-toast')
  await expect(updateToast).toBeVisible()
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await expect(updateToast).toBeHidden()
  expect(await page.evaluate(() => {
    const toast = document.querySelector<HTMLElement>('#update-toast')!
    const dock = document.querySelector<HTMLElement>('.order-panel')!
    const a = toast.getBoundingClientRect()
    const b = dock.getBoundingClientRect()
    return {
      display: getComputedStyle(toast).display,
      dockVisible: !dock.hidden && b.width > 0 && b.height > 0,
      overlaps: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
    }
  })).toEqual({ display: 'none', dockVisible: true, overlaps: false })
  const pauseButton = page.locator('#pause-button')
  const dialog = page.getByRole('dialog', { name: 'SHIFT PAUSED' })
  const resume = dialog.getByRole('button', { name: 'RESUME' })

  await page.keyboard.down('d')
  const startX = await page.evaluate(() => window.__scoopaloo.snapshot().player.x)
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().player.x)).toBeGreaterThan(startX + 5)
  await pauseButton.click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Timer and customer patience are stopped.', { exact: true })).toBeVisible()
  await expect(resume).toBeFocused()
  await page.screenshot({ path: 'test-results/pause-dock-paused-phone-390.png' })
  const before = await freezeReceipt(page)
  await page.waitForTimeout(500)
  expect(await freezeReceipt(page)).toEqual(before)
  await page.keyboard.up('d')
  await resume.click()
  await expect(dialog).toBeHidden()
  await expect(pauseButton).toBeFocused()
  await expect.poll(() => page.evaluate(time => window.__scoopaloo.snapshot().time > time, (before as { time: number }).time)).toBe(true)

  await pauseButton.click()
  await expect(resume).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(pauseButton).toBeFocused()

  await page.locator('canvas').focus()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })
  await expect(dialog).toBeVisible()
  await expect(resume).toBeFocused()
  const hidden = await freezeReceipt(page)
  await page.waitForTimeout(500)
  expect(await freezeReceipt(page)).toEqual(hidden)
  await resume.click()
  await expect(page.locator('canvas')).toBeFocused()

  await pauseButton.click()
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.advance(game.snapshot().shift.remaining)
  })
  await expect(dialog).toBeHidden()
  await expect(pauseButton).toBeHidden()
  await expect(page.getByRole('heading', { name: 'GOAL MISSED' })).toBeVisible()
  await expect(updateToast).toBeVisible()
  await page.locator('#play-button').click()
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().phase)).toBe('playing')
  await expect(dialog).toBeHidden()
  await expect(pauseButton).toBeVisible()
  await expect(updateToast).toBeHidden()
})

test('debug pause stays independent and tablet/desktop keep the top order layout', async ({ page }) => {
  await seedSave(page)
  await setPhone(page, PHONES[1])
  await page.goto('/')
  await setPhone(page, PHONES[1])
  await page.evaluate(() => {
    window.__scoopaloo.pause(true)
    window.__scoopaloo.startShift()
  })
  const pausedAt = await freezeReceipt(page)
  await page.waitForTimeout(250)
  expect(await freezeReceipt(page)).toEqual(pausedAt)
  await expect(page.getByRole('dialog', { name: 'SHIFT PAUSED' })).toBeHidden()

  await page.locator('#pause-button').click()
  await page.getByRole('button', { name: 'RESUME' }).click()
  await page.waitForTimeout(150)
  expect(await freezeReceipt(page)).toEqual(pausedAt)

  await page.evaluate(() => window.__scoopaloo.advance(.25))
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().time)).toBeCloseTo((pausedAt as { time: number }).time + .25, 6)

  for (const size of [
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'boundary', width: 912, height: 900 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size)
    await page.evaluate(() => dispatchEvent(new Event('resize')))
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
    const layout = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.order-panel')!.getBoundingClientRect()
      const ticket = document.querySelector<HTMLElement>('.order-ticket')!.getBoundingClientRect()
      const next = document.querySelector<HTMLElement>('.next-orders')!.getBoundingClientRect()
      const hud = document.querySelector<HTMLElement>('.shift-hud')!.getBoundingClientRect()
      const pause = document.querySelector<HTMLElement>('#pause-button')!.getBoundingClientRect()
      const view = window.__scoopaloo.viewport()
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      return {
        panel: { top: panel.top, bottom: panel.bottom, width: panel.width },
        ticketWidth: ticket.width,
        nextWidth: next.width,
        pause: {
          width: pause.width,
          height: pause.height,
          inside: pause.left >= 0 && pause.top >= 0 && pause.right <= innerWidth && pause.bottom <= innerHeight,
          clear: !overlaps(pause, hud) && !overlaps(pause, panel),
        },
        centeredOriginX: (960 - view.viewWidth) / 2,
        originX: view.originX,
        height: innerHeight,
      }
    })
    expect(layout.panel.width, size.name).toBeCloseTo(298, 0)
    expect(layout.ticketWidth, size.name).toBeCloseTo(230, 0)
    expect(layout.nextWidth, size.name).toBeCloseTo(60, 0)
    expect(layout.panel.bottom, size.name).toBeLessThan(layout.height / 2)
    expect(layout.pause, size.name).toEqual({ width: 48, height: 48, inside: true, clear: true })
    expect(layout.originX, size.name).toBeCloseTo(layout.centeredOriginX, 6)
    await page.screenshot({ path: `test-results/pause-dock-${size.name}-unchanged.png` })
  }

  await page.evaluate(() => window.__scoopaloo.pause(false))
  const unpausedAt = await page.evaluate(() => window.__scoopaloo.snapshot().time)
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().time)).toBeGreaterThan(unpausedAt)
})
