import { expect, test, type Page } from '@playwright/test'

// Issues 13 and 44's acceptance at the four target sizes, on ONE page that resizes
// between them so a stale transform anywhere fails the later sizes.
const SIZES = [
  { name: 'phone', width: 390, height: 844, safeTop: 59, safeBottom: 34 },
  { name: 'air', width: 420, height: 912, safeTop: 59, safeBottom: 34 },
  { name: 'tablet', width: 768, height: 1024, safeTop: 0, safeBottom: 0 },
  { name: 'desktop', width: 1440, height: 900, safeTop: 0, safeBottom: 0 },
]

test.use({ reducedMotion: 'reduce' })

async function assertSize(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250) // let ResizeObserver + rAF settle
  const checks = await page.evaluate(() => {
    const game = window.__scoopaloo
    const view = game.viewport()
    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    const skin = game.snapshot().skin
    const points = [
      ...Object.values(skin.producers).map(station => ({ kind: 'source', at: station.interaction })),
      ...Object.values(skin.prepStations).map(station => ({ kind: 'prep', at: station.interaction })),
      ...Object.values(skin.stations).map(station => ({ kind: 'service', at: station.interaction })),
    ].filter((point, index, all) => all.findIndex(candidate => candidate.at.join(',') === point.at.join(',')) === index)
    const dpr = Math.min(devicePixelRatio, 2)
    const boxes = ['.shift-hud', '.order-panel', '#save-button', '#sound-button'].map(selector =>
      document.querySelector(selector)!.getBoundingClientRect()).filter(box => box.width > 0 && box.height > 0)
    const safeTop = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0
    const safeBottom = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom')) || 0
    const inside = (box: { left: number; top: number; right: number; bottom: number }) =>
      box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    const client = ([x, y]: number[]) => ({ x: (x - view.originX) * view.scale, y: (y - view.originY) * view.scale })
    const overlapsPoint = (box: DOMRect, point: { x: number; y: number }) =>
      point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom
    const worldRect = (left: number, top: number, right: number, bottom: number) => ({
      left: client([left, top]).x,
      top: client([left, top]).y,
      right: client([right, bottom]).x,
      bottom: client([right, bottom]).y,
    })
    const depthScale = (y: number) => y <= 430 ? .82 : y >= 1030 ? 1.1 : .82 + .28 * ((y - 430) / 600)
    const groundedRect = (anchor: number[], bounds: number[]) => {
      const scale = depthScale(anchor[1])
      const scaled = (value: number, axis: number) => anchor[axis] + (value - anchor[axis]) * scale
      return worldRect(scaled(bounds[0], 0), scaled(bounds[1], 1), scaled(bounds[2], 0), scaled(bounds[3], 1))
    }
    const counter = skin.stations.counter
    const [counterX, counterY] = counter.interaction
    const [drawX, drawY, drawWidth, drawHeight] = counter.draw
    const visuals = [
      // Includes the sprite, stock shelf, shadow, and the service progress ring.
      worldRect(Math.min(drawX, counterX - 92), Math.min(drawY, counterY - 113),
        Math.max(drawX + drawWidth, counterX + 70), Math.max(drawY + drawHeight, counterY + 30)),
      // Four-person queue envelope, including each 116x132 customer sprite.
      worldRect(counterX - 8, counterY - 117, counterX + 180, counterY + 90),
    ]
    const sourceVisuals = Object.values(skin.producers).map(producer => {
      const [x, y, width, height] = producer.draw
      const [px, py] = producer.interaction
      const { origin, step, size } = producer.stockDisplay
      const last = Math.max(0, producer.capacity - 1)
      const stockX = [origin[0], origin[0] + step[0] * last]
      const stockY = [origin[1], origin[1] + step[1] * last]
      const ringY = Math.min(py + 35, 1120 - 40)
      return groundedRect([px, producer.depth], [
        Math.min(x, px - 69, px - 34, ...stockX),
        Math.min(y, py - 144, ringY - 31, ...stockY),
        Math.max(x + width, px + 69, px + 34, ...stockX.map(value => value + size[0])),
        Math.max(y + height, ringY + 31, ...stockY.map(value => value + size[1])),
      ])
    })
    const overlaps = (a: { left: number; top: number; right: number; bottom: number }, b: DOMRect) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    const opaque = (x: number, y: number) => {
      const ctx = canvas.getContext('2d')!
      return ctx.getImageData(x, y, 1, 1).data[3] === 255
    }
    return {
      canvasBox: { w: Math.round(rect.width), h: Math.round(rect.height) },
      window: { w: innerWidth, h: innerHeight },
      backing: { w: canvas.width, h: canvas.height },
      expectedBacking: { w: Math.round(innerWidth * dpr), h: Math.round(innerHeight * dpr) },
      corners: [
        opaque(0, 0), opaque(canvas.width - 1, 0),
        opaque(0, canvas.height - 1), opaque(canvas.width - 1, canvas.height - 1),
      ],
      stationsInView: points.every(({ at: [x, y] }) =>
        x >= view.originX && x <= view.originX + view.viewWidth &&
        y >= view.originY && y <= view.originY + view.viewHeight),
      uiInside: boxes.every(inside),
      stationsClear: points.every(point => boxes.every(box => !overlapsPoint(box, client(point.at)))),
      serviceVisualsInside: visuals.every(inside),
      serviceVisualsClear: visuals.every(visual => boxes.every(box => !overlaps(visual, box))),
      sourceVisualsInside: sourceVisuals.every(inside),
      sourceVisualsSafe: sourceVisuals.every(box => box.left >= 12 && box.right <= innerWidth - 12
        && box.bottom <= innerHeight - safeBottom - 12),
      sourceVisualsClear: sourceVisuals.every(visual => boxes.every(box => !overlaps(visual, box))),
      safeUi: boxes.every(box => box.top >= safeTop && box.bottom <= innerHeight - safeBottom),
      actionFont: Number.parseFloat(getComputedStyle(document.querySelector('.ticket-guidance')!).fontSize),
      primaryFont: Number.parseFloat(getComputedStyle(document.querySelector('.ticket-body')!).fontSize),
      secondaryFont: Math.min(...['.patience-values', '.recipe-list li', '.next-state', '.next-seconds']
        .flatMap(selector => [...document.querySelectorAll(selector)])
        .filter(element => getComputedStyle(element).display !== 'none')
        .map(element => Number.parseFloat(getComputedStyle(element).fontSize))),
      emptyInventory: {
        compact: document.querySelector('.inventory-readout')!.classList.contains('is-empty'),
        height: document.querySelector('.inventory-readout')!.getBoundingClientRect().height,
        summaryFont: Number.parseFloat(getComputedStyle(document.querySelector('.inventory-readout')!, '::after').fontSize),
      },
      yLegs: {
        serviceToPrep: Math.min(...points.filter(point => point.kind === 'prep').flatMap(prep =>
          points.filter(point => point.kind === 'service').map(service => Math.abs(client(prep.at).y - client(service.at).y)))),
        prepToSource: Math.min(...points.filter(point => point.kind === 'prep').flatMap(prep =>
          points.filter(point => point.kind === 'source').map(source => Math.abs(client(prep.at).y - client(source.at).y)))),
        sourceRows: [...new Set(points.filter(point => point.kind === 'source').map(point => Math.round(client(point.at).y)))].sort((a, b) => a - b),
      },
    }
  })
  expect(checks.canvasBox, name).toEqual({ w: checks.window.w, h: checks.window.h })
  expect(checks.backing, name).toEqual(checks.expectedBacking)
  expect(checks.corners, name).toEqual([true, true, true, true])
  expect(checks.stationsInView, name).toBe(true)
  expect(checks.uiInside, name).toBe(true)
  expect(checks.stationsClear, name).toBe(true)
  expect(checks.serviceVisualsInside, name).toBe(true)
  expect(checks.serviceVisualsClear, name).toBe(true)
  expect(checks.sourceVisualsInside, name).toBe(true)
  expect(checks.sourceVisualsClear, name).toBe(true)
  if (name === 'phone' || name === 'air') {
    expect(checks.sourceVisualsSafe, name).toBe(true)
    expect(checks.safeUi, name).toBe(true)
    expect(checks.actionFont, name).toBeGreaterThanOrEqual(15)
    expect(checks.primaryFont, name).toBeGreaterThanOrEqual(14)
    expect(checks.secondaryFont, name).toBeGreaterThanOrEqual(13)
    expect(checks.emptyInventory, name).toEqual({ compact: true, height: 32, summaryFont: 13 })
    expect(checks.yLegs.serviceToPrep).toBeGreaterThanOrEqual(name === 'air' ? 120 : 110)
    expect(checks.yLegs.prepToSource).toBeGreaterThanOrEqual(name === 'air' ? 120 : 110)
    expect(checks.yLegs.sourceRows).toHaveLength(2)
    expect(checks.yLegs.sourceRows[1] - checks.yLegs.sourceRows[0]).toBeGreaterThanOrEqual(90)
  }

  // the real pointer path: press each station's world point, the joystick origin
  // must land on that same world point through the live viewport
  const stations = await page.evaluate(() => {
    const skin = window.__scoopaloo.snapshot().skin
    return [...Object.values(skin.producers), ...Object.values(skin.prepStations), ...Object.values(skin.stations)]
      .map(station => station.interaction)
      .filter((point, index, all) => all.findIndex(candidate => candidate.join(',') === point.join(',')) === index)
  })
  for (const [wx, wy] of stations) {
    const client = await page.evaluate(([x, y]) => {
      const view = window.__scoopaloo.viewport()
      const rect = document.querySelector('canvas')!.getBoundingClientRect()
      return { x: rect.left + (x - view.originX) * view.scale, y: rect.top + (y - view.originY) * view.scale }
    }, [wx, wy])
    await page.mouse.move(client.x, client.y)
    await page.mouse.down()
    const origin = await page.evaluate(() => window.__scoopaloo.joystickOrigin())
    await page.mouse.up()
    expect(origin, `${name} station ${wx},${wy}`).not.toBeNull()
    expect(origin!.x, name).toBeCloseTo(wx, 0)
    expect(origin!.y, name).toBeCloseTo(wy, 0)
  }

  await page.screenshot({ path: `test-results/viewport-${name}.png` })
}

test('fills phone, iPhone Air, tablet, and desktop with one live-resized page', async ({ page }) => {
  await page.setViewportSize({ width: SIZES[0].width, height: SIZES[0].height })
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  await page.evaluate(() => { window.__scoopaloo.startShift(); window.__scoopaloo.pause(true) })
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.evaluate(({ safeTop, safeBottom }) => {
      document.documentElement.style.setProperty('--safe-top', `${safeTop}px`)
      document.documentElement.style.setProperty('--safe-bottom', `${safeBottom}px`)
      dispatchEvent(new Event('resize'))
    }, size)
    await assertSize(page, size.name)
  }
})

test('phone inventory expands clearly as soon as the tray is loaded', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 912 })
  await page.goto('/')
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-top', '59px')
    document.documentElement.style.setProperty('--safe-bottom', '34px')
    dispatchEvent(new Event('resize'))
    window.__scoopaloo.startShift()
    window.__scoopaloo.pause(true)
    const [x, y] = window.__scoopaloo.snapshot().skin.producers['soft-scoop'].interaction
    window.__scoopaloo.movePlayer({ x, y })
    window.__scoopaloo.advance(2)
  })
  await expect(page.locator('[data-inventory="tray"] img')).toHaveCount(1)
  await expect(page.locator('.inventory-readout')).not.toHaveClass(/is-empty/)
  const inventory = await page.locator('.inventory-readout').evaluate(element => ({
    height: element.getBoundingClientRect().height,
    rowsClear: [...element.children].every(row => row.scrollWidth <= row.clientWidth),
  }))
  expect(inventory.height).toBeGreaterThanOrEqual(44)
  expect(inventory.height).toBeLessThanOrEqual(48)
  expect(inventory.rowsClear).toBe(true)
})
