import { describe, expect, it } from 'vitest'
import { createGame, machineInterval, runFor, trayCapacity, walkSpeed } from './engine'
import { loadSave, storeSave } from './save'
import type { GameSkin } from './skin'
import { nextUpgrade, stationPoint, upgradeSpot } from './skin'
import skinData from './skins/ice-cream.json'

const skin = skinData as GameSkin

describe('ice cream stand loop', () => {
  it('takes interaction geometry from the selected skin', () => {
    expect(stationPoint(skin, 'machine')).toEqual({ x: skin.stations.machine.interaction[0], y: skin.stations.machine.interaction[1] })
    expect(stationPoint(skin, 'counter')).toEqual({ x: skin.stations.counter.interaction[0], y: skin.stations.counter.interaction[1] })
  })

  it('produces, carries, serves, pays, and upgrades', () => {
    const game = createGame(skin)
    runFor(game, 2)
    Object.assign(game.player, stationPoint(skin, 'machine'))
    runFor(game, 4)
    expect(game.player.tray).toBeGreaterThan(0)

    Object.assign(game.player, stationPoint(skin, 'counter'))
    runFor(game, 2)
    expect(game.counter.stock + game.flyingCoins.length + game.lifetimeCoins).toBeGreaterThan(0)

    Object.assign(game.player, stationPoint(skin, 'register'))
    runFor(game, 4)
    expect(game.lifetimeCoins).toBeGreaterThan(0)

    game.save.coins = 8
    Object.assign(game.player, upgradeSpot(skin.upgrades[0]))
    runFor(game, .1)
    expect(game.save.upgrades.shoes).toBe(1)
    expect(game.save.unlockedStations).toContain(skin.upgrades[0].unlocks)
  })
})

// The five purchase states of issue 12: locked, unaffordable, affordable,
// purchased, restored. Deterministic time via runFor throughout.
describe('data-driven progression (#12)', () => {
  const freshAt = (spotIndex: number, coins: number) => {
    const game = createGame(skin)
    game.save.coins = coins
    Object.assign(game.player, upgradeSpot(skin.upgrades[spotIndex]))
    return game
  }

  it('LOCKED: a later spot does nothing while an earlier upgrade is unowned', () => {
    const game = freshAt(1, 999)
    runFor(game, 1)
    expect(game.save.upgrades.tray).toBe(0)
    expect(game.save.coins).toBe(999)
  })

  it('UNAFFORDABLE: standing on the live spot without the price does nothing', () => {
    const game = freshAt(0, skin.upgrades[0].price - 1)
    runFor(game, 1)
    expect(game.save.upgrades.shoes).toBe(0)
    expect(game.save.coins).toBe(skin.upgrades[0].price - 1)
  })

  it('AFFORDABLE: buying deducts the price exactly once, even held for seconds', () => {
    const game = freshAt(0, skin.upgrades[0].price)
    runFor(game, 3) // stay parked on the spot well past the purchase tick
    expect(game.save.upgrades.shoes).toBe(1)
    expect(game.save.coins).toBe(0)
  })

  it('PURCHASED: each upgrade has an observable mechanical effect', () => {
    const game = createGame(skin)
    const baseSpeed = walkSpeed(game)
    const baseCapacity = trayCapacity(game)
    const baseInterval = machineInterval(game)
    for (const upgrade of skin.upgrades) game.save.upgrades[upgrade.id] = 1
    expect(walkSpeed(game)).toBe(baseSpeed + 25)
    expect(trayCapacity(game)).toBe(baseCapacity + 1)
    expect(machineInterval(game)).toBeCloseTo(baseInterval - .45)
  })

  it('RESTORED: a reloaded save keeps coins, upgrades, unlock order, and effects', () => {
    const game = freshAt(0, 50)
    runFor(game, 1) // buys shoes
    Object.assign(game.player, upgradeSpot(skin.upgrades[1]))
    runFor(game, 1) // buys tray
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    storeSave(game.save, storage)
    const restored = createGame(skin, loadSave(skin, storage))
    expect(restored.save.coins).toBe(50 - skin.upgrades[0].price - skin.upgrades[1].price)
    expect(restored.save.upgrades).toEqual({ shoes: 1, tray: 1, machine: 0 })
    expect(restored.save.unlockedStations).toEqual([
      skin.progression.startingStation, skin.upgrades[0].unlocks, skin.upgrades[1].unlocks,
    ])
    expect(walkSpeed(restored)).toBe(walkSpeed(game))
    expect(nextUpgrade(skin, restored.save.upgrades)?.id).toBe('machine')
  })
})
