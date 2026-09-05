import { describe, it, expect } from 'vitest'
import { createFloor, stepFloor, FLOOR, floorCheckpoint, floorComplete, floorStorage, FLOOR_KEY, nextFloorPurchase, validFloorSave, type FloorState } from './shop-floor'
import { createGame, endShift, startShift } from './engine'
import skinData from './skins/ice-cream.json'
import type { GameSkin } from './skin'

function wait(state: FloorState, seconds: number) { for (let n = 0; n < Math.ceil(seconds * 60); n++) stepFloor(state, 1 / 60) }
function walk(state: FloorState, point: { x: number; y: number }) {
  let ticks = 0
  while (Math.hypot(point.x - state.player.x, point.y - state.player.y) > 8 && ticks++ < 600) {
    const dx = point.x - state.player.x, dy = point.y - state.player.y
    const length = Math.hypot(dx, dy)
    stepFloor(state, 1 / 60, { x: dx / length, y: dy / length })
  }
  expect(ticks).toBeLessThan(600)
}
function serve(state: FloorState, count: number) {
  walk(state, FLOOR.scoop); wait(state, .65)
  walk(state, FLOOR.counters[0])
  for (let n = 0; state.save.served < count && n < 600; n++) stepFloor(state, 1 / 60)
  expect(state.save.served).toBeGreaterThanOrEqual(count)
}

describe('continuous shop opening, without teleporting or seeding money', () => {
  it('pays within 10s and opens usable floor within 60s; money is conserved', () => {
    const state = createFloor()
    serve(state, 2)
    expect(state.time).toBeLessThan(10)
    expect(state.save.cash).toBe(state.save.served * 20)
    walk(state, FLOOR.patio); wait(state, .7)
    expect(state.save.patio).toBe(true)
    expect(state.time).toBeLessThan(60)
    expect(state.save.cash).toBe(state.save.served * 20 - 40)
    walk(state, FLOOR.counters[1])
    expect(state.player.y).toBeGreaterThan(700)
    expect(state.customers.some(c => c.lane === 1)).toBe(true)
  })
  it('hires only after expansion; helper walks pickup and service, earning without player input', () => {
    const state = createFloor()
    serve(state, 2); walk(state, FLOOR.patio); wait(state, .7)
    serve(state, 5); walk(state, FLOOR.hire); wait(state, .7)
    expect(state.save.helper).toBe(true)
    expect(Math.hypot(state.helper.x - FLOOR.staffDoor.x, state.helper.y - FLOOR.staffDoor.y)).toBeLessThan(150)
    expect(state.helper.x).toBeGreaterThan(350)
    const start = state.helper.distance, earned = state.save.cash
    wait(state, 12)
    expect(state.helper.distance).toBeGreaterThan(start + 500)
    expect(state.helperServed).toBeGreaterThan(0)
    expect(state.save.cash).toBeGreaterThan(earned)
    expect(state.events.some(e => e.helper)).toBe(true)
    expect(state.save.cash).toBe(state.save.served * 20 - 100)
  })
  it('turns helper earnings into a real party job and a finite, earned ending', () => {
    const state = createFloor()
    serve(state, 2); walk(state, FLOOR.patio); wait(state, .7)
    serve(state, 5); walk(state, FLOOR.hire); wait(state, .7)
    expect(nextFloorPurchase(state)?.kind).toBe('party')
    wait(state, 40)
    expect(state.save.cash).toBeGreaterThanOrEqual(FLOOR.party.price)
    walk(state, FLOOR.party); wait(state, .7)
    expect(state.save.party).toBe(true)
    const before = state.save.cash
    wait(state, 12)
    expect(state.save.cash).toBeGreaterThan(before)
    expect(state.save.partyServed ?? 0).toBe(0) // Pip cannot finish the player's party for them.
    for (const target of [3, 6]) {
      walk(state, FLOOR.scoop); wait(state, .65)
      walk(state, FLOOR.counters[2])
      for (let ticks = 0; (state.save.partyServed ?? 0) < target && ticks < 1200; ticks++) stepFloor(state, 1 / 60)
      expect(state.save.partyServed).toBe(target)
    }
    expect(floorComplete(state)).toBe(true)
    expect(state.save.cash).toBe(state.save.served * FLOOR.price - 40 - 60 - 160)
    wait(state, 3)
    expect(state.customers.some(c => c.lane === 2)).toBe(false)
    expect(state.save.partyServed).toBe(6)
  })
  it('does not buy while merely passing through, overspend, or run while paused', () => {
    const state = createFloor()
    walk(state, FLOOR.patio); wait(state, 2)
    expect(state.save.patio).toBe(false)
    expect(state.player.y).toBeLessThanOrEqual(650)
    state.paused = true
    const before = structuredClone(state)
    wait(state, 10)
    expect(state).toEqual(before)
  })
})

describe('isolated preview save', () => {
  it('never touches the campaign and refuses concurrent overwrites', () => {
    const data = new Map([['scoopaloo_save_v1', 'existing campaign']])
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
    const first = floorStorage(storage), second = floorStorage(storage)
    const save = first.load(); second.load()
    save.cash = 40
    expect(first.store(save)).toBe(true)
    expect(second.store(createFloor().save)).toBe(false)
    expect(data.get('scoopaloo_save_v1')).toBe('existing campaign')
    expect(floorStorage(storage).load().cash).toBe(40)
  })
  it('preserves invalid/future data and survives unavailable storage', () => {
    let raw = '{"version":2,"cash":100}'
    const store = floorStorage({ getItem: () => raw, setItem: (_, value) => { raw = value } })
    const save = store.load()
    expect(store.store(save)).toBe(false)
    expect(raw).toContain('"version":2')
    const blocked = floorStorage({ getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('quota') } })
    expect(blocked.load().cash).toBe(0)
    expect(blocked.store(save)).toBe(false)
    expect(validFloorSave({ ...save, cash: -1 })).toBe(false)
    expect(validFloorSave({ ...save, helper: true, patio: false })).toBe(false)
    expect(FLOOR_KEY).not.toBe('scoopaloo_save_v1')
  })
  it('restores feet and carried cones without resetting the work or breaking old preview saves', () => {
    const state = createFloor()
    walk(state, FLOOR.scoop); wait(state, .65)
    walk(state, { x: 320, y: 550 })
    const saved = floorCheckpoint(state)
    expect(validFloorSave(saved)).toBe(true)
    const restored = createFloor(saved)
    expect(restored.player.x).toBe(state.player.x)
    expect(restored.player.y).toBe(state.player.y)
    expect(restored.player.cones).toBe(3)
    expect(restored.save).toEqual(state.save)
    expect(validFloorSave({ ...saved, player: { x: -100, y: 400, cones: 3 } })).toBe(false)
    expect(validFloorSave({ ...saved, party: true })).toBe(false)
    expect(validFloorSave({ version: 1, cash: 40, served: 2, patio: true, helper: false })).toBe(true)
  })
})

it('ending a campaign shift keeps paid coins, awards the actual result once, and makes the menu reachable', () => {
  const state = createGame(skinData as GameSkin)
  startShift(state)
  state.flyingCoins = [false, false, true].map(collected => ({ x: 0, y: 0, vx: 0, vy: 0, age: .1, collected, value: 5 }))
  expect(endShift(state)).toBe(true)
  expect(state.phase).toBe('results')
  expect(state.shift.endedByPlayer).toBe(true)
  expect(state.save.coins).toBe(10)
  expect(state.save.lifetimeCash).toBe(10)
  expect(state.shift.revenue).toBe(10)
  expect(state.flyingCoins).toEqual([])
  expect(endShift(state)).toBe(false)
  expect(state.save.coins).toBe(10)
})
