import { describe, expect, it, vi } from 'vitest'
import { createGame, defaultSave } from './engine'
import type { GameSkin } from './skin'
import skinData from './skins/ice-cream.json'
import {
  MOTION_DISTANCES,
  MOTION_TIMES,
  LOCKED_PRODUCER_PLAQUE,
  Renderer,
  blinkPose,
  carryPose,
  customerExitPose,
  gaitFrame,
  interactionRingPose,
  introStationAlpha,
  latestMachineEventAge,
  lockedProducerLabel,
  lockedProducerLabelFont,
  machinePose,
  roomPropAnchor,
  sourceVisualItem,
  stationOcclusionAlpha,
  transferPose,
  visibleCounterRunner,
  visibleCounters,
  visibleHelper,
  walkPose,
  walkSheetFrame,
  walkSheetPlacement,
} from './render'

describe('static parlor shell (#15)', () => {
  it('pins the panoramic backdrop and grounded plant geometry', () => {
    expect(skinData.room).toEqual({
      horizon: 320,
      wall: '#FFE7CA',
      floor: '#FFF3E6',
      backdrop: {
        image: '/assets/room/ice-cream-wall.svg?v=3',
        draw: [-416, 0, 1792, 1200],
      },
      floorProp: {
        image: '/assets/room/mint-plant.svg?v=1',
        draw: [190, 400, 80, 112],
      },
      annex: {
        label: 'CHOCOLATE CORNER',
        unlockStation: 'chocolate-scoop',
        boundaryX: 780,
        doorway: [770, 320, 20, 800],
      },
    })
    expect(roomPropAnchor(skinData.room.floorProp.draw)).toEqual({ x: 230, y: 512 })
  })
})

describe('second service counter (#53)', () => {
  it('adds the built expansion to the grounded counter draw list', () => {
    const state = createGame(skinData as GameSkin)
    expect(visibleCounters(state).map(counter => counter.id)).toEqual(['primary'])

    state.save.upgrades['second-counter'] = 1
    state.secondaryCounter.serveTimer = .35
    expect(visibleCounters(state)).toEqual([
      { id: 'primary', station: skinData.stations.counter, serveTimer: 0 },
      { id: 'secondary', station: skinData.counterExpansion.station, serveTimer: .35 },
    ])
  })
})

describe('parked counter runner (#54)', () => {
  it('appears beside the built second counter before hiring and keeps skin-owned geometry', () => {
    const state = createGame(skinData as GameSkin)
    expect(visibleCounterRunner(state)).toBeNull()

    state.save.upgrades['second-counter'] = 1
    expect(visibleCounterRunner(state)).toEqual(skinData.counterRunner)
  })
})

describe('progressive helper visibility (#63)', () => {
  it('keeps Pip out of Day 1 and Day 2, then shows the parked helper on Day 3', () => {
    const save = defaultSave(skinData as GameSkin)
    expect(visibleHelper(createGame(skinData as GameSkin, save))).toBeNull()
    save.currentDay = 1
    expect(visibleHelper(createGame(skinData as GameSkin, save))).toBeNull()
    save.currentDay = 2
    expect(visibleHelper(createGame(skinData as GameSkin, save))).toEqual(skinData.helper)
  })
})

describe('deterministic service motion (#16)', () => {
  it('samples two planted poses and a pass pose from actual walking distance', () => {
    const first = walkPose(MOTION_DISTANCES.WALK_PLANT_A, true, 1)
    const pass = walkPose(MOTION_DISTANCES.WALK_PASS_A, true, 1)
    const second = walkPose(MOTION_DISTANCES.WALK_PLANT_B, true, 1)

    expect(first).toMatchObject({ stride: 1, x: 1.5, y: 0 })
    expect(pass.x).toBeCloseTo(0)
    expect(pass.y).toBeCloseTo(-4)
    expect(pass.scaleY).toBeGreaterThan(1)
    expect(second).toMatchObject({ stride: -1, x: -1.5, y: 0 })
    expect(first.lean).toBeCloseTo(.03)
    expect(second.lean).toBeCloseTo(-.03)
    expect(walkPose(0, true, 1)).toEqual(walkPose(MOTION_DISTANCES.WALK_CYCLE, true, 1))
    const reduced = walkPose(MOTION_DISTANCES.WALK_PASS_A, true, 1, true)
    expect(reduced.y).toBeCloseTo(pass.y * .28)
    expect(reduced.y).not.toBe(0)
    expect(walkPose(10, false, -1)).toEqual({
      stride: 0, x: 0, y: 0, lean: 0, scaleX: 1, scaleY: 1, shadowX: 43, shadowY: 13,
    })
  })

  it('keeps a directional moving silhouette throughout both gait beats', () => {
    const sprites = (skinData as GameSkin).sprites.player

    expect(gaitFrame(0, 1, sprites)).toEqual({ sprite: sprites.walkRight, flipX: false, beat: 0 })
    expect(gaitFrame(MOTION_DISTANCES.WALK_PLANT_B, 1, sprites)).toEqual({
      sprite: sprites.walkLeft, flipX: true, beat: 1,
    })
    expect(gaitFrame(0, -1, sprites)).toEqual({ sprite: sprites.walkLeft, flipX: false, beat: 0 })
    expect(gaitFrame(MOTION_DISTANCES.WALK_PLANT_B, -1, sprites)).toEqual({
      sprite: sprites.walkRight, flipX: true, beat: 1,
    })
  })

  it('makes larger loads wobble more and preserves a damped reduced-motion cue', () => {
    const distance = MOTION_DISTANCES.WALK_PASS_A
    const single = carryPose(distance, 1, 1, 1)
    const stack = carryPose(distance, 1, 4, 1)
    const reduced = carryPose(distance, 1, 4, 1, true)

    expect(single.amplitude).toBeCloseTo(2.1)
    expect(stack.amplitude).toBeCloseTo(4.8)
    expect(Math.abs(stack.x)).toBeGreaterThan(Math.abs(single.x))
    expect(reduced.amplitude).toBeCloseTo(stack.amplitude * .28)
    expect(reduced.x).not.toBe(0)
    expect(carryPose(distance, 0, 5, -1).amplitude).toBe(0)
  })

  it('arcs and stretches transfers but lands exactly on authoritative coordinates', () => {
    const from = { x: 10, y: 20 }
    const to = { x: 110, y: 70 }
    const apex = transferPose('pickup', MOTION_TIMES.PICKUP_APEX, from, to)
    const land = transferPose('pickup', MOTION_TIMES.PICKUP_LAND, from, to)
    const reduced = transferPose('pickup', MOTION_TIMES.PICKUP_APEX, from, to, true)

    expect(apex.progress).toBe(.5)
    expect(apex.x).toBeCloseTo(97.5)
    expect(apex.y).toBeCloseTo(45.75)
    expect(apex.scaleX).toBeCloseTo(.82)
    expect(apex.scaleY).toBeCloseTo(1.18)
    expect(land).toMatchObject({ x: to.x, y: to.y, scaleX: 1, scaleY: 1, progress: 1 })
    expect(land.rotation).toBeCloseTo(0)
    expect(reduced.y - (from.y + (to.y - from.y) * .875)).toBeCloseTo(-18 * .28)
    expect(from).toEqual({ x: 10, y: 20 })
    expect(to).toEqual({ x: 110, y: 70 })

    const drop = transferPose('drop', MOTION_TIMES.DROP_LAND, from, to)
    expect(drop).toMatchObject({ x: to.x, y: to.y, scaleX: 1, scaleY: 1, progress: 1 })
  })

  it('closes deterministic blinks and rests machines outside source actions', () => {
    expect(blinkPose(MOTION_TIMES.BLINK_START)).toBeCloseTo(0)
    expect(blinkPose(MOTION_TIMES.BLINK_CLOSED)).toBeCloseTo(1)
    expect(blinkPose(MOTION_TIMES.BLINK_END)).toBeCloseTo(0)
    expect(blinkPose(2)).toBe(0)

    const rest = machinePose()
    const action = machinePose(MOTION_TIMES.MACHINE_APEX)
    const ended = machinePose(MOTION_TIMES.MACHINE_END + .01)
    const reduced = machinePose(MOTION_TIMES.MACHINE_APEX, true)
    expect(rest).toEqual({ x: 0, y: 0, rotation: 0, scaleY: 1, pulse: 0 })
    expect(action.pulse).toBeCloseTo(1)
    expect(action.y).toBeCloseTo(-2)
    expect(ended).toEqual(rest)
    expect(reduced.y).toBeCloseTo(action.y * .28)
    expect(reduced.y).not.toBe(0)

    const state = createGame(skinData as GameSkin)
    state.events = [
      { kind: 'pour', source: 'soft-scoop', age: .2, createdAt: 100, x: 1, y: 2 },
      { kind: 'pickup', source: 'cone-shell', age: .01, createdAt: 101, x: 3, y: 4 },
      { kind: 'pickup', source: 'soft-scoop', age: .05, createdAt: -500, x: 5, y: 6 },
    ]
    expect(latestMachineEventAge(state.events, 'soft-scoop')).toBe(.05)
    expect(latestMachineEventAge(state.events, 'sundae-cup')).toBeUndefined()
  })
})

describe('kid-first render guidance (#63)', () => {
  it('loads the fixed walk sheet and marks it as a required renderer asset', () => {
    class ReadyImage {
      complete = true
      naturalWidth = 1448
      naturalHeight = 1086
      src = ''
    }
    vi.stubGlobal('Image', ReadyImage)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    try {
      const skin = skinData as GameSkin
      const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement
      const renderer = new Renderer(canvas, skin)
      expect(skin.playerWalkSheet).toBe('/assets/player-walk.png?v=1')
      expect(renderer.playerWalkImage?.src).toBe(skin.playerWalkSheet)
      expect(renderer.assetsReady()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('selects four distance-local frames and mirrors only the left row', () => {
    expect(walkSheetFrame(0, 'down')).toEqual({ column: 0, row: 0, flipX: false })
    expect(walkSheetFrame(MOTION_DISTANCES.WALK_PASS_A, 'right')).toEqual({
      column: 1, row: 1, flipX: false,
    })
    expect(walkSheetFrame(MOTION_DISTANCES.WALK_PLANT_B, 'up')).toEqual({
      column: 2, row: 2, flipX: false,
    })
    expect(walkSheetFrame(MOTION_DISTANCES.WALK_PASS_B, 'left')).toEqual({
      column: 3, row: 1, flipX: true,
    })
    expect(walkSheetFrame(MOTION_DISTANCES.WALK_CYCLE, 'right')).toEqual({
      column: 0, row: 1, flipX: false,
    })

  })

  it('normalizes all twelve measured frames to the atlas idle center, size, and baseline', () => {
    const expected = [
      [[167, 11, 181, 342], [109, 12, 179, 340], [67, 10, 178, 343], [17, 10, 179, 343]],
      [[164, 8, 173, 323], [104, 7, 175, 324], [66, 8, 176, 325], [13, 6, 175, 327]],
      [[162, -18, 173, 336], [105, -16, 171, 332], [67, -16, 172, 338], [14, -16, 173, 334]],
    ]
    const directions = ['down', 'right', 'up'] as const

    for (const [row, direction] of directions.entries()) {
      for (let column = 0; column < 4; column++) {
        const frame = walkSheetFrame(column * MOTION_DISTANCES.WALK_PASS_A, direction)
        const placement = walkSheetPlacement(frame, 480, 880)
        expect([
          placement.sourceX - column * 362,
          placement.sourceY - row * 362,
          placement.sourceWidth,
          placement.sourceHeight,
        ]).toEqual(expected[row][column])
        expect(placement.destinationWidth).toBe(112.5)
        expect(placement.destinationHeight).toBe(134)
        expect(placement.destinationX + placement.destinationWidth / 2).toBeCloseTo(480.7)
        expect(placement.destinationY + placement.destinationHeight).toBeCloseTo(888.5)
        if (row === 1) expect(placement.sourceY + placement.sourceHeight).toBeLessThan(2 * 362 - 20)
      }
    }
  })

  it('uses direct-source inventory and keeps the first route visually obvious', () => {
    const state = createGame(skinData as GameSkin)

    expect(sourceVisualItem(state, 'soft-scoop')).toBe('vanilla-cone')
    expect(sourceVisualItem(state, 'sundae-cup')).toBe('sundae')
    expect(lockedProducerLabel(state, 'sundae-cup')).toBe('3 MORE')
    state.shift.served = 2
    expect(lockedProducerLabel(state, 'sundae-cup')).toBe('1 MORE')
    state.sources['soft-scoop'].item = 'sundae'
    expect(sourceVisualItem(state, 'soft-scoop')).toBe('sundae')
    expect(introStationAlpha(true, true)).toBe(1)
    expect(introStationAlpha(true, false)).toBe(.16)
    expect(introStationAlpha(true, false, true)).toBe(.12)
    expect(introStationAlpha(false, false, true)).toBe(1)
  })

  it('steps down a wider fallback font instead of squashing locked labels', () => {
    const width = (font: string): number => 78.2 * Number(font.match(/(\d+)px/)![1]) / 18
    const font = lockedProducerLabelFont('3 MORE', candidate => width(candidate))

    expect(font).toContain('17px')
    expect(LOCKED_PRODUCER_PLAQUE.labelMaxWidth - width(font))
      .toBeGreaterThanOrEqual(LOCKED_PRODUCER_PLAQUE.labelHeadroom)
  })

  it('gives served customers a damped but readable happy exit hop', () => {
    const happy = customerExitPose(.26, true)
    const reduced = customerExitPose(.26, true, true)
    const missed = customerExitPose(.26, false)

    expect(happy.y).toBeCloseTo(-18)
    expect(happy.scaleX).toBeGreaterThan(1)
    expect(reduced.y).toBeCloseTo(happy.y * .28)
    expect(reduced.y).not.toBe(0)
    expect(missed.y).toBeGreaterThan(0)
  })
})

describe('interaction clarity motion (#44)', () => {
  it('focuses interaction rings, confirms contact, and freezes reduced dash travel', () => {
    const far = interactionRingPose(1, 130)
    const focus = interactionRingPose(1, 68)
    const contact = interactionRingPose(1, 68, .12)
    const reduced = interactionRingPose(1, 68, .12, true)

    expect(far).toEqual({ radiusX: 67, radiusY: 29, lineWidth: 4, dashOffset: -18 })
    expect(focus).toEqual({ radiusX: 63, radiusY: 27, lineWidth: 6, dashOffset: -18 })
    expect(contact).toMatchObject({ lineWidth: 8, dashOffset: -18 })
    expect(contact.radiusX).toBeCloseTo(68.04)
    expect(contact.radiusY).toBeCloseTo(24.3)
    expect(reduced.dashOffset).toBe(0)
    expect(reduced.lineWidth).toBe(8)
    expect(Math.abs(reduced.radiusX - 67)).toBeLessThan(Math.abs(contact.radiusX - 67))
    expect(interactionRingPose(2, 68, .24)).toEqual({
      radiusX: 63, radiusY: 27, lineWidth: 6, dashOffset: -36,
    })
  })

  it('fades only station art that visibly covers a player behind it', () => {
    const cone = skinData.producers['cone-shell']
    const prep = skinData.prepStations['build-station']
    const counter = skinData.stations.counter

    expect(stationOcclusionAlpha(
      { x: cone.interaction[0], y: 910 }, cone.draw, { x: cone.interaction[0], y: cone.depth },
    )).toBeLessThan(.6)
    expect(stationOcclusionAlpha(
      { x: prep.interaction[0], y: 725 }, prep.draw, { x: prep.interaction[0], y: prep.depth },
    )).toBeLessThan(.6)
    expect(stationOcclusionAlpha(
      { x: counter.interaction[0], y: 540 }, counter.draw, { x: counter.interaction[0], y: counter.depth },
    )).toBeLessThan(1)
    expect(stationOcclusionAlpha(
      { x: 480, y: 910 }, cone.draw, { x: cone.interaction[0], y: cone.depth },
    )).toBe(1)
    expect(stationOcclusionAlpha(
      { x: cone.interaction[0], y: 940 }, cone.draw, { x: cone.interaction[0], y: cone.depth },
    )).toBe(1)
  })
})
