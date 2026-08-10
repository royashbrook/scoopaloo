import { describe, expect, it } from 'vitest'
import { WORLD } from './engine'
import { dragVector } from './input'
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

  it.each([[390, 844], [420, 912]])('portrait %d×%d: follows west, center, and east with exact clamps', (width, height) => {
    const west = computeViewport(width, height, 3, 34, 0)
    expect(west.originX).toBe(0)
    expect(computeViewport(width, height, 3, 34, WORLD.width / 2).originX).toBe(160)
    const east = computeViewport(width, height, 3, 34, WORLD.width)
    expect(east.originX).toBe(320)
    for (const view of [west, east]) {
      const client = worldToClient(view, { x: view.originX + 123, y: 700 })
      expect(clientToWorld(view, client.x, client.y)).toEqual({ x: view.originX + 123, y: 700 })
    }
  })

  it('keeps the camera still while focus remains inside the dead zone', () => {
    const west = computeViewport(390, 844, 3, 34, 0)
    expect(computeViewport(390, 844, 3, 34, 300, west.originX).originX).toBe(0)
    expect(computeViewport(390, 844, 3, 34, 450, 100).originX).toBe(100)
  })

  it('keeps a held CSS drag vector exact across a west-to-east camera pan', () => {
    const west = computeViewport(390, 844, 3, 34, 0)
    const east = computeViewport(390, 844, 3, 34, WORLD.width, west.originX)
    expect([west.originX, east.originX]).toEqual([0, 320])
    const expected = { x: 60 / Math.hypot(60, 40), y: -40 / Math.hypot(60, 40) }
    expect(dragVector({ x: 90, y: 500 }, { x: 150, y: 460 })).toEqual(expected)
    expect(dragVector({ x: 90, y: 500 }, { x: 150, y: 460 })).toEqual(expected)
  })

  it('reserves the phone home-indicator area without changing the shared transform', () => {
    const view = computeViewport(420, 912, 3, 34)
    expect(view.scale).toBeCloseTo(420 / PORTRAIT_LANE_WIDTH)
    expect(worldToClient(view, { x: WORLD.width / 2, y: WORLD.height }).y).toBeLessThan(912 - 34)
    const client = worldToClient(view, { x: 480, y: 880 })
    const world = clientToWorld(view, client.x, client.y)
    expect(world.x).toBeCloseTo(480)
    expect(world.y).toBeCloseTo(880)
  })

  it('landscape wider than 3:2: extra world left and right, centered', () => {
    const view = computeViewport(1440, 900, 1)
    expect(view.scale).toBeCloseTo(900 / WORLD.height)
    expect(view.viewHeight).toBeCloseTo(WORLD.height)
    expect(view.viewWidth).toBeGreaterThan(WORLD.width)
    expect(view.originX).toBeCloseTo((WORLD.width - view.viewWidth) / 2)
    expect(view.originX).toBeLessThan(0)
  })

  it('ignores focus when the full world fits', () => {
    const west = computeViewport(1440, 900, 1, 0, 0, 200)
    const east = computeViewport(1440, 900, 1, 0, WORLD.width, 0)
    expect(west.originX).toBeCloseTo((WORLD.width - west.viewWidth) / 2)
    expect(east.originX).toBeCloseTo((WORLD.width - east.viewWidth) / 2)
  })

  it('keeps a portrait tablet centered while focus moves', () => {
    const west = computeViewport(768, 1024, 2, 0, 0, 0)
    const east = computeViewport(768, 1024, 2, 0, WORLD.width, 320)
    expect(west.originX).toBe(60)
    expect(east.originX).toBe(60)
  })

  it('caps backing density at 2 and reports exact backing pixels', () => {
    expect(computeViewport(390, 844, 3).dpr).toBe(2)
    expect(computeViewport(390, 844, 1.5).dpr).toBe(1.5)
    expect(backingSize(computeViewport(390, 844, 3))).toEqual({ width: 780, height: 1688 })
  })

  it('round trips client to world to client at both aspect branches', () => {
    for (const [w, h, bottom] of [[390, 844, 34], [420, 912, 34], [1440, 900, 0], [768, 1024, 0]]) {
      const view = computeViewport(w, h, 2, bottom)
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
