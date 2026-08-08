import { describe, expect, it } from 'vitest'
import { createGame, runFor } from './engine'
import type { GameSkin } from './skin'
import { stationPoint } from './skin'
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
    Object.assign(game.player, stationPoint(skin, 'build'))
    runFor(game, .1)
    expect(game.save.upgrades.shoes).toBe(1)
    expect(game.save.unlockedStations).toContain(skin.progression.firstBuildUnlock)
  })
})
