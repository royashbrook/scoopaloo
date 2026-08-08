import { describe, expect, it } from 'vitest'
import { WORLD } from './engine'
import { backingSize, clientToWorld, computeViewport, PORTRAIT_LANE_WIDTH, worldToClient } from './viewport'

describe('shared viewport (#13)', () => {
  it('portrait: zooms into the central play lane and biases the shop below the HUD', () => {
    const view = computeViewport(390, 844, 3)
    expect(view.scale).toBeCloseTo(390 / PORTRAIT_LANE_WIDTH)
    expect(view.viewWidth).toBeCloseTo(PORTRAIT_LANE_WIDTH)
    expect(view.viewHeight).toBeGreaterThan(WORLD.height)
    expect(view.originX).toBeCloseTo((WORLD.width - PORTRAIT_LANE_WIDTH) / 2)
    expect(view.originY).toBeLessThan((WORLD.height - view.viewHeight) / 2)
    expect(view.originY).toBeLessThan(0)
  })

  it('landscape wider than 3:2: extra world left and right, centered', () => {
    const view = computeViewport(1440, 900, 1)
    expect(view.scale).toBeCloseTo(900 / WORLD.height)
    expect(view.viewHeight).toBeCloseTo(WORLD.height)
    expect(view.viewWidth).toBeGreaterThan(WORLD.width)
    expect(view.originX).toBeCloseTo((WORLD.width - view.viewWidth) / 2)
    expect(view.originX).toBeLessThan(0)
  })

  it('caps backing density at 2 and reports exact backing pixels', () => {
    expect(computeViewport(390, 844, 3).dpr).toBe(2)
    expect(computeViewport(390, 844, 1.5).dpr).toBe(1.5)
    expect(backingSize(computeViewport(390, 844, 3))).toEqual({ width: 780, height: 1688 })
  })

  it('round trips client to world to client at both aspect branches', () => {
    for (const [w, h] of [[390, 844], [1440, 900], [768, 1024]]) {
      const view = computeViewport(w, h, 2)
      for (const point of [{ x: 10, y: 10 }, { x: w / 2, y: h / 2 }, { x: w - 1, y: h - 1 }]) {
        const world = clientToWorld(view, point.x, point.y)
        const back = worldToClient(view, world)
        expect(back.x).toBeCloseTo(point.x)
        expect(back.y).toBeCloseTo(point.y)
      }
    }
  })

  it('a resize changes the mapping consistently: same client point, new world point, still round-trips', () => {
    const before = computeViewport(390, 844, 2)
    const after = computeViewport(844, 390, 2)
    const world = clientToWorld(after, 100, 100)
    expect(worldToClient(after, world).x).toBeCloseTo(100)
    expect(clientToWorld(before, 100, 100)).not.toEqual(world)
  })
})
