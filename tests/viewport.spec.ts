import { expect, test, type Page } from '@playwright/test'

// Issue 13's acceptance at the three target sizes, on ONE page that resizes
// between them so a stale transform anywhere fails the later sizes.
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
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
    const boxes = ['.shift-hud', '.order-ticket', '#save-button', '#sound-button'].map(selector =>
      document.querySelector(selector)!.getBoundingClientRect())
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
      sourceVisualsClear: sourceVisuals.every(visual => boxes.every(box => !overlaps(visual, box))),
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
  if (name === 'phone') {
    expect(checks.yLegs.serviceToPrep).toBeGreaterThanOrEqual(120)
    expect(checks.yLegs.prepToSource).toBeGreaterThanOrEqual(120)
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

test('fills phone, tablet, and desktop with one live-resized page', async ({ page }) => {
  await page.setViewportSize({ width: SIZES[0].width, height: SIZES[0].height })
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  await page.evaluate(() => { window.__scoopaloo.startShift(); window.__scoopaloo.pause(true) })
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height })
    await assertSize(page, size.name)
  }
})
