import { expect, test, type Page } from '@playwright/test'
import { depthScale } from '../src/depth'

const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'air', width: 420, height: 912 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
] as const

const ROOM = {
  horizon: 320,
  wall: '#FFE7CA',
  floor: '#FFF3E6',
  backdrop: { image: '/assets/room/ice-cream-wall.svg?v=3', draw: [-416, 0, 1792, 1200] },
  floorProp: { image: '/assets/room/mint-plant.svg?v=1', draw: [190, 400, 80, 112] },
  annex: {
    label: 'CHOCOLATE CORNER',
    unlockStation: 'chocolate-scoop',
    boundaryX: 780,
    doorway: [770, 320, 20, 800],
  },
}

type DrawTrace = {
  kind: 'backdrop' | 'floorProp' | 'player'
  args: number[]
  transform: number[]
}

async function repaint(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function paintAt(page: Page, time: number): Promise<void> {
  await page.evaluate(value => window.__scoopaloo.setTime(value), time)
  await repaint(page)
}

async function installTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as Window & { __roomTrace?: DrawTrace[] }
    const state = window.__scoopaloo.snapshot()
    const paths = {
      backdrop: new URL(state.skin.room.backdrop.image, location.href).pathname,
      floorProp: new URL(state.skin.room.floorProp.image, location.href).pathname,
      atlas: new URL(state.skin.spriteSheet, location.href).pathname,
    }
    const context = document.querySelector('canvas')!.getContext('2d')!
    const originalDraw = context.drawImage.bind(context) as (...args: unknown[]) => void
    const originalClear = context.clearRect.bind(context)
    target.__roomTrace = []
    Object.defineProperty(context, 'drawImage', {
      configurable: true,
      value: (...args: unknown[]) => {
        const source = args[0] as { src?: string }
        const path = source.src ? new URL(source.src, location.href).pathname : ''
        const kind = path === paths.backdrop ? 'backdrop'
          : path === paths.floorProp ? 'floorProp'
            : path === paths.atlas && args.at(-2) === 132 && args.at(-1) === 142 ? 'player'
              : undefined
        if (kind) {
          const { a, b, c, d, e, f } = context.getTransform()
          target.__roomTrace!.push({ kind, args: args.slice(1).map(Number), transform: [a, b, c, d, e, f] })
        }
        originalDraw(...args)
      },
    })
    Object.defineProperty(context, 'clearRect', {
      configurable: true,
      value: (x: number, y: number, width: number, height: number) => {
        target.__roomTrace!.length = 0
        originalClear(x, y, width, height)
      },
    })
  })
  await repaint(page)
}

async function trace(page: Page): Promise<DrawTrace[]> {
  await repaint(page)
  return page.evaluate(() =>
    (window as Window & { __roomTrace?: DrawTrace[] }).__roomTrace ?? [])
}

async function wallHash(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas')!
    const context = canvas.getContext('2d')!
    const view = window.__scoopaloo.viewport()
    const room = window.__scoopaloo.snapshot().skin.room
    const [assetX, assetY, assetWidth, assetHeight] = room.backdrop.draw
    const scale = view.scale * view.dpr
    const left = Math.max(view.originX, assetX)
    const top = Math.max(view.originY, assetY)
    const right = Math.min(view.originX + view.viewWidth, assetX + assetWidth)
    const bottom = Math.min(view.originY + view.viewHeight, room.horizon, assetY + assetHeight)
    const pixels = context.getImageData(
      Math.floor((left - view.originX) * scale),
      Math.floor((top - view.originY) * scale),
      Math.ceil((right - left) * scale),
      Math.ceil((bottom - top) * scale),
    ).data
    let hash = 2166136261
    for (const value of pixels) hash = Math.imul(hash ^ value, 16777619)
    return hash >>> 0
  })
}

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })

test('renders the cached parlor shell behind depth-sorted play at every target size', async ({ context, page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  const room = await page.evaluate(() => window.__scoopaloo.snapshot().skin.room)
  expect(room).toEqual(ROOM)

  await page.evaluate(() => navigator.serviceWorker.ready)
  const cached = await page.evaluate(async paths =>
    Promise.all(paths.map(async path => Boolean(await caches.match(path)))), [room.backdrop.image, room.floorProp.image])
  expect(cached).toEqual([true, true])

  await page.reload()
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
  await page.evaluate(() => {
    window.__scoopaloo.pause(true)
    window.__scoopaloo.startShift()
  })

  const svgReports = await page.evaluate(async assets => Promise.all(assets.map(async asset => {
    const response = await fetch(asset.image)
    const document = new DOMParser().parseFromString(await response.text(), 'image/svg+xml')
    const viewBox = document.documentElement.getAttribute('viewBox')!.split(/\s+/).map(Number)
    const external = [...document.querySelectorAll('*')].flatMap(element => [...element.attributes]).some(attribute =>
      (['href', 'src'].includes(attribute.localName) && !attribute.value.startsWith('#'))
      || (!attribute.localName.startsWith('xmlns') && /(?:https?:)?\/\//.test(attribute.value)))
    const image = new Image()
    image.src = asset.image
    await image.decode()
    return {
      ok: response.ok,
      type: response.headers.get('content-type'),
      forbidden: document.querySelectorAll('text, script, foreignObject, image').length,
      external,
      viewBox,
      shellParts: ['floor', 'side-returns', 'work-floor', 'floor-seams',
        'chocolate-corner-floor', 'chocolate-corner-wall']
        .filter(id => document.getElementById(id)).length,
      ratio: viewBox[2] / viewBox[3],
      decoded: image.naturalWidth > 0,
    }
  })), [room.backdrop, room.floorProp])
  for (let index = 0; index < svgReports.length; index++) {
    expect(svgReports[index]).toMatchObject({ ok: true, forbidden: 0, external: false, decoded: true })
    expect(svgReports[index].type).toContain('image/svg+xml')
    expect(svgReports[index].ratio).toBeCloseTo([room.backdrop, room.floorProp][index].draw[2]
      / [room.backdrop, room.floorProp][index].draw[3], 6)
  }
  expect(svgReports[0].viewBox).toEqual(room.backdrop.draw)
  expect(svgReports.map(report => report.shellParts)).toEqual([6, 0])

  await installTrace(page)
  const draws = await trace(page)
  const backdrop = draws.find(draw => draw.kind === 'backdrop')!
  const floorProp = draws.find(draw => draw.kind === 'floorProp')!
  expect(backdrop.args).toEqual(room.backdrop.draw)
  expect(floorProp.args).toEqual(room.floorProp.draw)
  expect(floorProp.transform[0] / backdrop.transform[0]).toBeCloseTo(depthScale(512), 6)
  expect(draws.indexOf(backdrop)).toBeLessThan(draws.indexOf(floorProp))

  await page.evaluate(() => window.__scoopaloo.movePlayer({ x: 230, y: 511 }))
  const behind = (await trace(page)).map(draw => draw.kind)
  expect(behind.indexOf('player')).toBeLessThan(behind.indexOf('floorProp'))
  await page.evaluate(() => window.__scoopaloo.movePlayer({ x: 230, y: 513 }))
  const inFront = (await trace(page)).map(draw => draw.kind)
  expect(inFront.indexOf('floorProp')).toBeLessThan(inFront.indexOf('player'))
  await page.evaluate(() => window.__scoopaloo.movePlayer({ x: 480, y: 880 }))

  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height })
    await paintAt(page, 20)
    const floorCoverage = await page.evaluate(() => {
      const view = window.__scoopaloo.viewport()
      const room = window.__scoopaloo.snapshot().skin.room
      const [x, y, width, height] = room.backdrop.draw
      return x <= view.originX
        && x + width >= view.originX + view.viewWidth
        && y <= room.horizon
        && y + height >= view.originY + view.viewHeight
    })
    expect(floorCoverage, size.name).toBe(true)
    if (size.name === 'air') {
      const contrast = await page.evaluate(() => {
        const canvas = document.querySelector('canvas')!
        const context = canvas.getContext('2d')!
        const view = window.__scoopaloo.viewport()
        const sample = (x: number, y: number) => context.getImageData(
          Math.round((x - view.originX) * view.scale * view.dpr),
          Math.round((y - view.originY) * view.scale * view.dpr),
          1,
          1,
        ).data
        const workFloor = sample(480, 400)
        const openFloor = sample(300, 400)
        return [...workFloor].reduce((total, value, index) => total + Math.abs(value - openFloor[index]), 0)
      })
      expect(contrast).toBeGreaterThanOrEqual(24)
    }
    const first = await wallHash(page)
    await paintAt(page, 27.25)
    expect(await wallHash(page), size.name).toBe(first)
    await page.screenshot({ path: `test-results/room-${size.name}.png` })
  }

  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.atlasReady())).toBe(true)
  await context.setOffline(false)
})
