import { expect, test, type Page } from '@playwright/test'

// Issue 13's acceptance at the three target sizes, on ONE page that resizes
// between them so a stale transform anywhere fails the later sizes.
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]

async function assertSize(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250) // let ResizeObserver + rAF settle
  const checks = await page.evaluate(() => {
    const game = window.__scoopaloo
    const view = game.viewport()
    const canvas = document.querySelector('canvas')!
    const rect = canvas.getBoundingClientRect()
    const skin = game.snapshot().skin
    const stations = Object.values(skin.stations).map(station => station.interaction)
    const dpr = Math.min(devicePixelRatio, 2)
    const save = document.querySelector('#save-button')!.getBoundingClientRect()
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
      stationsInView: stations.every(([x, y]) =>
        x >= view.originX && x <= view.originX + view.viewWidth &&
        y >= view.originY && y <= view.originY + view.viewHeight),
      saveInView: save.left >= 0 && save.top >= 0 && save.right <= innerWidth && save.bottom <= innerHeight,
    }
  })
  expect(checks.canvasBox, name).toEqual({ w: checks.window.w, h: checks.window.h })
  expect(checks.backing, name).toEqual(checks.expectedBacking)
  expect(checks.corners, name).toEqual([true, true, true, true])
  expect(checks.stationsInView, name).toBe(true)
  expect(checks.saveInView, name).toBe(true)

  // the real pointer path: press each station's world point, the joystick origin
  // must land on that same world point through the live viewport
  const stations = await page.evaluate(() => Object.values(window.__scoopaloo.snapshot().skin.stations).map(s => s.interaction))
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
  await page.evaluate(() => window.__scoopaloo.startShift())
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height })
    await assertSize(page, size.name)
  }
})
