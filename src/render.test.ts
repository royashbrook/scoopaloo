import { describe, expect, it } from 'vitest'
import skinData from './skins/ice-cream.json'
import {
  MOTION_TIMES,
  blinkPose,
  carryPose,
  machinePose,
  roomPropAnchor,
  transferPose,
  walkPose,
} from './render'

describe('static parlor shell (#15)', () => {
  it('pins the panoramic backdrop and grounded plant geometry', () => {
    expect(skinData.room).toEqual({
      horizon: 320,
      wall: '#FFE7CA',
      floor: '#FFF3E6',
      backdrop: {
        image: '/assets/room/ice-cream-wall.svg?v=1',
        draw: [-416, 0, 1792, 320],
      },
      floorProp: {
        image: '/assets/room/mint-plant.svg?v=1',
        draw: [190, 400, 80, 112],
      },
    })
    expect(roomPropAnchor(skinData.room.floorProp.draw)).toEqual({ x: 230, y: 512 })
  })
})

describe('deterministic service motion (#16)', () => {
  it('samples two planted walk poses, a pass pose, and immediate idle', () => {
    const first = walkPose(MOTION_TIMES.WALK_PLANT_A, true, 1)
    const pass = walkPose(MOTION_TIMES.WALK_PASS, true, 1)
    const second = walkPose(MOTION_TIMES.WALK_PLANT_B, true, 1)

    expect(first).toMatchObject({ stride: 1, x: 2, y: -4 })
    expect(pass.x).toBeCloseTo(0)
    expect(pass.y).toBeCloseTo(0)
    expect(second).toMatchObject({ stride: -1, x: -2, y: -4 })
    expect(first.lean).toBeCloseTo(.045)
    expect(second.lean).toBeCloseTo(-.045)
    expect(walkPose(10, false, -1)).toEqual({
      stride: 0, x: 0, y: 0, lean: 0, shadowX: 43, shadowY: 13,
    })
  })

  it('makes larger loads wobble more and preserves a damped reduced-motion cue', () => {
    const time = MOTION_TIMES.CARRY_CYCLE / 4
    const single = carryPose(time, 1, 1, 1)
    const stack = carryPose(time, 1, 4, 1)
    const reduced = carryPose(time, 1, 4, 1, true)

    expect(single.amplitude).toBeCloseTo(2.1)
    expect(stack.amplitude).toBeCloseTo(4.8)
    expect(Math.abs(stack.x)).toBeGreaterThan(Math.abs(single.x))
    expect(reduced.amplitude).toBeCloseTo(stack.amplitude * .28)
    expect(reduced.x).not.toBe(0)
    expect(carryPose(time, 0, 5, -1).amplitude).toBe(0)
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

  it('closes deterministic blinks and desynchronizes machine hums', () => {
    expect(blinkPose(MOTION_TIMES.BLINK_START)).toBeCloseTo(0)
    expect(blinkPose(MOTION_TIMES.BLINK_CLOSED)).toBeCloseTo(1)
    expect(blinkPose(MOTION_TIMES.BLINK_END)).toBeCloseTo(0)
    expect(blinkPose(2)).toBe(0)

    const first = machinePose(MOTION_TIMES.MACHINE_APEX, 0)
    const second = machinePose(MOTION_TIMES.MACHINE_APEX, 1)
    const secondApex = machinePose(2.67, 1)
    const reduced = machinePose(MOTION_TIMES.MACHINE_APEX, 0, true)
    expect(first.pulse).toBeCloseTo(1)
    expect(first.y).toBeCloseTo(-2)
    expect(second.pulse).toBe(0)
    expect(secondApex.pulse).toBeCloseTo(1)
    expect(reduced.y).toBeCloseTo(first.y * .28)
    expect(reduced.y).not.toBe(0)
  })
})
