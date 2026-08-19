import { expect, test, type Page } from '@playwright/test'
import { MOTION_TIMES } from '../src/render'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

type WorldBox = { left: number; top: number; right: number; bottom: number }
type ItemDraw = { args: number[]; transform: number[] }
type WalkSheetDraw = { args: number[]; transform: number[] }

function transformedPoint(transform: number[], x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = transform
  return { x: a * x + c * y + e, y: b * x + d * y + f }
}

async function paintAt(page: Page, time: number): Promise<void> {
  await page.evaluate(value => window.__scoopaloo.setTime(value), time)
  await repaint(page)
}

async function repaint(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function advanceWalk(page: Page, seconds: number, input: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ duration, vector }) => {
    const game = window.__scoopaloo
    game.advance(duration, vector)
    // Preserve the visual anchor while retaining authoritative walkDistance,
    // direction, and moving state from the real step.
    game.movePlayer({ x: 480, y: 880 })
  }, { duration: seconds, vector: input })
  await repaint(page)
}

async function startPaused(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
  await page.evaluate(() => {
    window.__scoopaloo.pause(true)
    window.__scoopaloo.startShift()
  })
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const round = (value: number) => Math.round(value * 1_000) / 1_000
    const box = (selector: string) => {
      const { left, top, right, bottom } = document.querySelector(selector)!.getBoundingClientRect()
      return [left, top, right, bottom].map(round)
    }
    const state = window.__scoopaloo.snapshot()
    const anchors = [
      ...Object.entries(state.skin.producers).map(([id, value]) => [id, ...value.interaction]),
      ...Object.entries(state.skin.prepStations).map(([id, value]) => [id, ...value.interaction]),
      ...Object.entries(state.skin.stations).map(([id, value]) => [id, ...value.interaction]),
    ]
    return {
      ui: ['.shift-hud', '.order-panel', '#save-button', '#sound-button'].map(box),
      anchors,
      player: [round(state.player.x), round(state.player.y)],
      viewport: window.__scoopaloo.viewport(),
    }
  })
}

async function worldHash(page: Page, box: WorldBox): Promise<number> {
  return page.evaluate(bounds => {
    const canvas = document.querySelector('canvas')!
    const context = canvas.getContext('2d')!
    const view = window.__scoopaloo.viewport()
    const k = view.scale * view.dpr
    const left = Math.max(0, Math.floor((bounds.left - view.originX) * k))
    const top = Math.max(0, Math.floor((bounds.top - view.originY) * k))
    const right = Math.min(canvas.width, Math.ceil((bounds.right - view.originX) * k))
    const bottom = Math.min(canvas.height, Math.ceil((bounds.bottom - view.originY) * k))
    const pixels = context.getImageData(left, top, Math.max(1, right - left), Math.max(1, bottom - top)).data
    let hash = 2166136261
    for (const value of pixels) hash = Math.imul(hash ^ value, 16777619)
    return hash >>> 0
  }, box)
}

async function itemDraws(page: Page, item: string): Promise<ItemDraw[]> {
  await page.evaluate(itemId => {
    type Trace = { icon: string; draws: ItemDraw[] }
    const target = window as Window & { __motionTrace?: Trace }
    const context = document.querySelector('canvas')!.getContext('2d')!
    if (!target.__motionTrace) {
      const trace: Trace = { icon: '', draws: [] }
      target.__motionTrace = trace
      const originalDraw = context.drawImage.bind(context) as (...args: unknown[]) => void
      const originalClear = context.clearRect.bind(context)
      Object.defineProperty(context, 'drawImage', {
        configurable: true,
        value: (...args: unknown[]) => {
          const source = args[0] as { src?: string }
          if (source.src?.endsWith(trace.icon)) {
            const { a, b, c, d, e, f } = context.getTransform()
            trace.draws.push({ args: args.slice(1).map(Number), transform: [a, b, c, d, e, f] })
          }
          originalDraw(...args)
        },
      })
      Object.defineProperty(context, 'clearRect', {
        configurable: true,
        value: (x: number, y: number, width: number, height: number) => {
          trace.draws.length = 0
          originalClear(x, y, width, height)
        },
      })
    }
    target.__motionTrace.icon = window.__scoopaloo.snapshot().skin.items[itemId].icon
  }, item)
  await repaint(page)
  return page.evaluate(() => {
    const target = window as Window & { __motionTrace?: { draws: ItemDraw[] } }
    return target.__motionTrace?.draws ?? []
  })
}

async function walkSheetDraws(page: Page): Promise<WalkSheetDraw[]> {
  await page.evaluate(() => {
    type Trace = { draws: WalkSheetDraw[] }
    const target = window as Window & { __walkSheetTrace?: Trace }
    const context = document.querySelector('canvas')!.getContext('2d')!
    if (!target.__walkSheetTrace) {
      const trace: Trace = { draws: [] }
      target.__walkSheetTrace = trace
      const originalDraw = context.drawImage.bind(context) as (...args: unknown[]) => void
      const originalClear = context.clearRect.bind(context)
      Object.defineProperty(context, 'drawImage', {
        configurable: true,
        value: (...args: unknown[]) => {
          const source = args[0] as { src?: string }
          if (source.src?.includes('/assets/player-walk.webp')) {
            const { a, b, c, d, e, f } = context.getTransform()
            trace.draws.push({ args: args.slice(1).map(Number), transform: [a, b, c, d, e, f] })
          }
          originalDraw(...args)
        },
      })
      Object.defineProperty(context, 'clearRect', {
        configurable: true,
        value: (x: number, y: number, width: number, height: number) => {
          trace.draws.length = 0
          originalClear(x, y, width, height)
        },
      })
    }
  })
  await repaint(page)
  return page.evaluate(() => {
    const target = window as Window & { __walkSheetTrace?: { draws: WalkSheetDraw[] } }
    return target.__walkSheetTrace?.draws ?? []
  })
}

async function pointerOriginAt(page: Page, [x, y]: number[]) {
  const client = await page.evaluate(([worldX, worldY]) => {
    const view = window.__scoopaloo.viewport()
    const canvas = document.querySelector('canvas')!.getBoundingClientRect()
    return {
      x: canvas.left + (worldX - view.originX) * view.scale,
      y: canvas.top + (worldY - view.originY) * view.scale,
    }
  }, [x, y])
  await page.mouse.move(client.x, client.y)
  await page.mouse.down()
  const origin = await page.evaluate(() => window.__scoopaloo.joystickOrigin())
  await page.mouse.up()
  return origin
}

async function createPickup(page: Page, requestedSourceId?: string) {
  return page.evaluate(sourceIdFromTest => {
    const game = window.__scoopaloo
    const state = game.snapshot()
    const sourceId = sourceIdFromTest ?? Object.keys(state.sources)[0]
    const source = state.skin.producers[sourceId]
    const item = state.sources[sourceId].item
    const before = state.player.trayItems[item] ?? 0
    // Stand at the ring edge so the real pickup happens without hiding the
    // player directly behind the producer art in the fixed capture.
    game.movePlayer({ x: source.interaction[0] + 50, y: source.interaction[1] })
    for (let tick = 0; tick < 50 && (game.snapshot().player.trayItems[item] ?? 0) === before; tick++) game.advance(.2)
    const after = game.snapshot()
    const event = [...after.events].reverse().find(candidate => candidate.kind === 'pickup')!
    return {
      source: source.interaction,
      item,
      before,
      after: after.player.trayItems[item] ?? 0,
      createdAt: event.createdAt,
      from: event.from,
    }
  }, requestedSourceId)
}

async function createDrop(page: Page) {
  return page.evaluate(() => {
    const game = window.__scoopaloo
    game.advance(.05)
    const first = game.snapshot()
    const front = first.customers.find(customer => !customer.served && !customer.missed)!
    const recipe = first.skin.items[front.order.item].recipe!
    for (const [input, quantity] of Object.entries(recipe.inputs)) {
      const state = game.snapshot()
      const source = Object.values(state.skin.producers).find(candidate => candidate.item === input)!
      const target = (state.player.trayItems[input] ?? 0) + quantity
      game.movePlayer({ x: source.interaction[0], y: source.interaction[1] })
      for (let tick = 0; tick < 100 && (game.snapshot().player.trayItems[input] ?? 0) < target; tick++) game.advance(.2)
    }
    const prep = first.skin.prepStations[recipe.station].interaction
    game.movePlayer({ x: prep[0], y: prep[1] })
    for (let tick = 0; tick < 100 && (game.snapshot().player.trayItems[front.order.item] ?? 0) < 1; tick++) game.advance(.2)
    game.movePlayer({ x: 480, y: 880 })
    for (let tick = 0; tick < 20 && game.snapshot().pickupCooldown > 0; tick++) game.advance(.05)
    const counter = first.skin.stations.counter.interaction
    const before = game.snapshot().player.trayItems[front.order.item] ?? 0
    game.movePlayer({ x: counter[0], y: counter[1] })
    game.advance(.01)
    const after = game.snapshot()
    const event = [...after.events].reverse().find(candidate => candidate.kind === 'drop')
    if (!event) throw new Error('drop event missing')
    return {
      counter,
      item: front.order.item,
      before,
      after: after.player.trayItems[front.order.item] ?? 0,
      createdAt: event.createdAt,
      from: event.from,
    }
  })
}

test('captures distance-local phone gait, blink, source action, and reduced feedback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await startPaused(page)
  await page.evaluate(() => window.__scoopaloo.movePlayer({ x: 480, y: 880 }))
  await advanceWalk(page, .01, { x: 1, y: 0 })

  await paintAt(page, 1)
  const normalGeometry = await geometry(page)
  const playerBody = { left: 420, top: 795, right: 545, bottom: 910 }
  const plantA = await worldHash(page, playerBody)
  const anchor = normalGeometry.anchors[0].slice(1) as number[]
  const originA = await pointerOriginAt(page, anchor)
  await page.screenshot({ path: 'test-results/animation-phone-walk-a.png' })

  await advanceWalk(page, .24, { x: 1, y: 0 })
  const plantB = await worldHash(page, playerBody)
  expect(plantB).not.toBe(plantA)
  expect(await geometry(page)).toEqual(normalGeometry)
  const originB = await pointerOriginAt(page, anchor)
  expect(originA).toEqual(originB)
  expect(originB!.x).toBeCloseTo(anchor[0], 0)
  expect(originB!.y).toBeCloseTo(anchor[1], 0)
  await page.screenshot({ path: 'test-results/animation-phone-walk-b.png' })

  await advanceWalk(page, .12, { x: 1, y: 0 })
  const pass = await worldHash(page, playerBody)
  expect(pass).not.toBe(plantA)
  expect(pass).not.toBe(plantB)
  expect((await geometry(page)).anchors).toEqual(normalGeometry.anchors)
  await page.screenshot({ path: 'test-results/animation-phone-walk-pass.png' })

  await page.evaluate(() => window.__scoopaloo.advance(.01))
  await paintAt(page, MOTION_TIMES.BLINK_PERIOD)
  const playerEyes = { left: 474, top: 798, right: 524, bottom: 826 }
  const eyesOpen = await worldHash(page, playerEyes)
  await paintAt(page, MOTION_TIMES.BLINK_CLOSED)
  const eyesClosed = await worldHash(page, playerEyes)
  expect(eyesClosed).not.toBe(eyesOpen)
  await page.screenshot({ path: 'test-results/animation-phone-blink.png' })

  await page.evaluate(apex => {
    const game = window.__scoopaloo
    const sourceId = 'soft-scoop'
    const source = game.snapshot().skin.producers[sourceId]
    game.movePlayer({ x: source.interaction[0], y: source.interaction[1] })
    for (let tick = 0; tick < 200; tick++) {
      game.advance(.01)
      const event = [...game.snapshot().events].reverse()
        .find(candidate => candidate.kind === 'pickup' && candidate.source === sourceId)
      if (!event) continue
      game.advance(Math.max(0, apex - event.age))
      game.movePlayer({ x: 480, y: 880 })
      return
    }
    throw new Error('source pickup event missing')
  }, MOTION_TIMES.MACHINE_APEX)
  await repaint(page)
  const vanillaMachine = { left: 300, top: 930, right: 430, bottom: 1_040 }
  const machineActive = await worldHash(page, vanillaMachine)
  await page.screenshot({ path: 'test-results/animation-phone-machine.png' })
  await page.evaluate(seconds => window.__scoopaloo.advance(seconds), MOTION_TIMES.MACHINE_END)
  await repaint(page)
  expect(await worldHash(page, vanillaMachine)).not.toBe(machineActive)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await startPaused(page)
  await page.evaluate(() => window.__scoopaloo.movePlayer({ x: 480, y: 880 }))
  await advanceWalk(page, .01, { x: 1, y: 0 })
  await paintAt(page, 1)
  const reduced = await worldHash(page, playerBody)
  expect(reduced).not.toBe(plantA)
  expect((await geometry(page)).anchors).toEqual(normalGeometry.anchors)
  await page.screenshot({ path: 'test-results/animation-phone-reduced.png' })
})

test('keeps the normalized walk sheet continuous from idle in all four phone directions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const cases = [
    { direction: 'down', seconds: .17, input: { x: 0, y: 1 } },
    { direction: 'right', seconds: .13, input: { x: 1, y: 0 } },
    { direction: 'up', seconds: .17, input: { x: 0, y: -1 } },
    { direction: 'left', seconds: .13, input: { x: -1, y: 0 } },
  ] as const
  const centers: { x: number; y: number }[] = []
  const baselines: { x: number; y: number }[] = []

  for (const [index, entry] of cases.entries()) {
    await startPaused(page)
    await page.evaluate(() => window.__scoopaloo.movePlayer({ x: 480, y: 880 }))
    if (index === 0) await page.screenshot({ path: 'test-results/animation-phone-walk-idle.png' })
    await advanceWalk(page, entry.seconds, entry.input)
    const player = await page.evaluate(() => window.__scoopaloo.snapshot().player)
    expect(player).toMatchObject({ x: 480, y: 880, direction: entry.direction, moving: true })
    const draws = await walkSheetDraws(page)
    expect(draws).toHaveLength(1)
    const [, , , , x, y, width, height] = draws[0].args
    expect(width).toBe(112.5)
    expect(height).toBe(134)
    centers.push(transformedPoint(draws[0].transform, x + width / 2, y + height / 2))
    baselines.push(transformedPoint(draws[0].transform, x + width / 2, y + height))
    await page.screenshot({ path: `test-results/animation-phone-walk-${entry.direction}.png` })
  }

  for (const points of [centers, baselines]) {
    expect(Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x))).toBeLessThan(5)
    expect(Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y))).toBeLessThan(5)
  }
})

test('uses real inventory ticks for transfer captures and keeps responsive geometry fixed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await startPaused(page)
  const pickup = await createPickup(page)
  expect(pickup.after).toBe(pickup.before + 1)
  expect(pickup.from).toEqual({ x: pickup.source[0], y: pickup.source[1] })
  await paintAt(page, pickup.createdAt + MOTION_TIMES.PICKUP_APEX)
  expect(await page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, pickup.item)).toBe(pickup.after)
  const pickupDraws = await itemDraws(page, pickup.item)
  const pickupFlight = pickupDraws.filter(draw => draw.args.join(',') === '-17,-20,34,40')
  expect(pickupFlight).toHaveLength(1)
  expect(pickupDraws.filter(draw => draw.args[1] === -36 && draw.args[3] === 40)).toHaveLength(0)
  expect(Math.abs(pickupFlight[0].transform[1]) + Math.abs(pickupFlight[0].transform[2])).toBeGreaterThan(.01)
  await page.screenshot({ path: 'test-results/animation-phone-pickup.png' })

  const energy = await page.evaluate(() => {
    const game = window.__scoopaloo
    game.movePlayer({ x: 480, y: 880 })
    game.advance(.2, { x: 1, y: 0 })
    const loaded = game.snapshot().player.trayWobble
    game.advance(.4)
    return { loaded, settled: game.snapshot().player.trayWobble }
  })
  expect(energy.loaded).toBe(1)
  expect(energy.settled).toBe(0)

  await startPaused(page)
  const drop = await createDrop(page)
  expect(drop.before).toBeGreaterThan(0)
  expect(drop.after).toBe(drop.before - 1)
  expect(drop.from).toEqual({ x: drop.counter[0], y: drop.counter[1] })
  await paintAt(page, drop.createdAt + MOTION_TIMES.DROP_APEX)
  expect(await page.evaluate(item => window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, drop.item)).toBe(drop.after)
  const dropDraws = await itemDraws(page, drop.item)
  const dropFlight = dropDraws.filter(draw => draw.args.join(',') === '-17,-20,34,40')
  expect(dropFlight).toHaveLength(1)
  expect(dropDraws.filter(draw => draw.args[2] === 29 && draw.args[3] === 38)).toHaveLength(0)
  expect(Math.abs(dropFlight[0].transform[1]) + Math.abs(dropFlight[0].transform[2])).toBeGreaterThan(.01)
  await page.screenshot({ path: 'test-results/animation-phone-drop.png' })

  await startPaused(page)
  const combined = await createPickup(page)
  await page.evaluate(() => {
    window.__scoopaloo.movePlayer({ x: 480, y: 880 })
    window.__scoopaloo.advance(.1, { x: 1, y: 0 })
  })
  const fixedTime = combined.createdAt + MOTION_TIMES.PICKUP_APEX
  for (const size of [
    { name: 'tablet', width: 768, height: 1_024 },
    { name: 'desktop', width: 1_440, height: 900 },
  ]) {
    await page.setViewportSize(size)
    await paintAt(page, fixedTime)
    const before = await geometry(page)
    await paintAt(page, fixedTime + MOTION_TIMES.WALK_CYCLE)
    expect(await geometry(page)).toEqual(before)
    await paintAt(page, fixedTime)
    const canvas = await page.locator('canvas').boundingBox()
    expect(canvas).toMatchObject({ x: 0, y: 0, width: size.width, height: size.height })
    await page.screenshot({ path: `test-results/animation-${size.name}-combined.png` })
  }
})

test('focuses interaction rings and keeps the player readable behind foreground stations at iPhone Air size', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 912 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await startPaused(page)
  const producer = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const source = state.skin.producers['soft-scoop']
    return {
      interaction: source.interaction,
      visualY: Math.min(source.interaction[1] + 35, 1_120 - 40),
    }
  })
  const ringBox = {
    left: producer.interaction[0] - 75,
    top: producer.visualY + 10,
    right: producer.interaction[0] + 75,
    bottom: producer.visualY + 40,
  }
  await paintAt(page, 1)
  const original = await geometry(page)
  expect(original.viewport).toMatchObject({
    cssWidth: 420,
    cssHeight: 912,
    scale: .65625,
    originX: 160,
    originY: -46.98412698412692,
    dpr: 1,
  })

  await page.evaluate(point => window.__scoopaloo.movePlayer({ x: point[0] + 130, y: point[1] }), producer.interaction)
  await paintAt(page, 1)
  const far = await worldHash(page, ringBox)
  await page.screenshot({ path: 'test-results/animation-air-ring-far.png' })

  await page.evaluate(point => window.__scoopaloo.movePlayer({ x: point[0] + 90, y: point[1] }), producer.interaction)
  await paintAt(page, 1)
  const focus = await worldHash(page, ringBox)
  expect(focus).not.toBe(far)
  const focusedGeometry = await geometry(page)
  expect(focusedGeometry.ui).toEqual(original.ui)
  expect(focusedGeometry.anchors).toEqual(original.anchors)
  expect(focusedGeometry.viewport).toMatchObject({
    cssWidth: original.viewport.cssWidth,
    cssHeight: original.viewport.cssHeight,
    scale: original.viewport.scale,
    originY: original.viewport.originY,
    dpr: original.viewport.dpr,
  })
  expect(focusedGeometry.viewport.originX).toBeLessThanOrEqual(original.viewport.originX)
  await page.screenshot({ path: 'test-results/animation-air-ring-focus.png' })

  const pickup = await createPickup(page, 'soft-scoop')
  await paintAt(page, pickup.createdAt + MOTION_TIMES.DROP_APEX)
  const contact = await worldHash(page, ringBox)
  expect(contact).not.toBe(focus)
  await page.screenshot({ path: 'test-results/animation-air-ring-contact.png' })
  await paintAt(page, pickup.createdAt + MOTION_TIMES.DROP_LAND)
  await page.screenshot({ path: 'test-results/animation-air-ring-settled.png' })
  const afterContact = await geometry(page)
  expect(afterContact.anchors).toEqual(original.anchors)
  expect(afterContact.viewport).toMatchObject({
    cssWidth: original.viewport.cssWidth,
    cssHeight: original.viewport.cssHeight,
    scale: original.viewport.scale,
    originY: original.viewport.originY,
    dpr: original.viewport.dpr,
  })
  expect(afterContact.viewport.originX).toBeLessThan(focusedGeometry.viewport.originX)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await startPaused(page)
  await page.evaluate(point => window.__scoopaloo.movePlayer({ x: point[0] + 130, y: point[1] }), producer.interaction)
  await paintAt(page, 1)
  const reducedFar = await worldHash(page, ringBox)
  await paintAt(page, 2)
  expect(await worldHash(page, ringBox)).toBe(reducedFar)
  await page.evaluate(point => window.__scoopaloo.movePlayer({ x: point[0] + 90, y: point[1] }), producer.interaction)
  await paintAt(page, 1)
  expect(await worldHash(page, ringBox)).not.toBe(reducedFar)
  const reducedPickup = await createPickup(page, 'soft-scoop')
  await paintAt(page, reducedPickup.createdAt + MOTION_TIMES.DROP_APEX)
  const reducedContact = await worldHash(page, ringBox)
  expect(reducedContact).not.toBe(contact)
  await page.screenshot({ path: 'test-results/animation-air-ring-reduced.png' })

  await startPaused(page)
  await page.evaluate(() => {
    const game = window.__scoopaloo
    const prep = game.snapshot().skin.prepStations['build-station']
    game.movePlayer({ x: prep.interaction[0], y: prep.depth - 15 })
    game.setTime(2)
  })
  await repaint(page)
  const occluded = await geometry(page)
  expect(occluded.ui).toEqual(original.ui)
  expect(occluded.anchors).toEqual(original.anchors)
  expect(occluded.viewport).toEqual(original.viewport)
  await page.screenshot({ path: 'test-results/animation-air-station-fade.png' })
})
