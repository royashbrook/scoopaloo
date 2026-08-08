import { describe, expect, it } from 'vitest'
import { createGame, POSITIONS, runFor } from './engine'

describe('ice cream stand loop', () => {
  it('produces, carries, serves, pays, and upgrades', () => {
    const game = createGame()
    runFor(game, 2)
    game.player.x = POSITIONS.machine.x
    game.player.y = POSITIONS.machine.y
    runFor(game, 4)
    expect(game.player.tray).toBeGreaterThan(0)

    game.player.x = POSITIONS.counter.x
    game.player.y = POSITIONS.counter.y
    runFor(game, 2)
    expect(game.counter.stock + game.flyingCoins.length + game.lifetimeCoins).toBeGreaterThan(0)

    game.player.x = POSITIONS.register.x
    game.player.y = POSITIONS.register.y
    runFor(game, 4)
    expect(game.lifetimeCoins).toBeGreaterThan(0)

    game.save.coins = 8
    game.player.x = POSITIONS.build.x
    game.player.y = POSITIONS.build.y
    runFor(game, .1)
    expect(game.save.upgrades.shoes).toBe(1)
    expect(game.save.unlockedStations).toContain('sundae-cart')
  })
})
