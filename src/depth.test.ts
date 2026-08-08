import { describe, expect, it } from 'vitest'
import { byDepth, depthScale, FAR_SCALE, FAR_Y, NEAR_SCALE, NEAR_Y } from './depth'
import { createGame, runFor, startShift } from './engine'
import type { GameSkin } from './skin'
import skinData from './skins/ice-cream.json'

const skin = skinData as GameSkin

describe('depth scale (#14)', () => {
  it('hits the exact far and near endpoints', () => {
    expect(depthScale(FAR_Y)).toBe(FAR_SCALE)
    expect(depthScale(NEAR_Y)).toBe(NEAR_SCALE)
  })

  it('clamps above the far line and below the near line', () => {
    expect(depthScale(FAR_Y - 200)).toBe(FAR_SCALE)
    expect(depthScale(NEAR_Y + 200)).toBe(NEAR_SCALE)
  })

  it('interpolates linearly: the midpoint is the mean scale', () => {
    expect(depthScale((FAR_Y + NEAR_Y) / 2)).toBeCloseTo((FAR_SCALE + NEAR_SCALE) / 2)
  })
})

describe('the one sort rule (#14)', () => {
  const counterDepth = skin.stations.counter.depth

  it('player draws behind the counter one unit above its ground line', () => {
    const player = { anchor: { x: 620, y: counterDepth - 1 } }
    const counter = { anchor: { x: 650, y: counterDepth } }
    expect([counter, player].sort(byDepth)[0]).toBe(player)
  })

  it('player draws in front one unit below', () => {
    const player = { anchor: { x: 620, y: counterDepth + 1 } }
    const counter = { anchor: { x: 650, y: counterDepth } }
    expect([player, counter].sort(byDepth)[1]).toBe(player)
  })

  it('equal depth keeps insertion order: sort is stable by contract', () => {
    const first = { anchor: { x: 1, y: 300 }, tag: 'first' }
    const second = { anchor: { x: 2, y: 300 }, tag: 'second' }
    expect([first, second].sort(byDepth).map(item => item.tag)).toEqual(['first', 'second'])
  })
})

describe('display scale never leaks into gameplay (#14)', () => {
  it('walk distance per second is identical on the far and near floor', () => {
    const far = createGame(skin)
    startShift(far)
    far.player.x = 200; far.player.y = 250
    runFor(far, 1, { x: 1, y: 0 })
    const near = createGame(skin)
    startShift(near)
    near.player.x = 200; near.player.y = 560
    runFor(near, 1, { x: 1, y: 0 })
    expect(far.player.x - 200).toBeCloseTo(near.player.x - 200)
  })
})
