import { describe, expect, it } from 'vitest'
import {
  createGame,
  goalMet,
  machineInterval,
  retryShift,
  runFor,
  startShift,
  step,
  tipFor,
  trayCapacity,
  walkSpeed,
  type GameState,
  type Point,
} from './engine'
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
    startShift(game)
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
    startShift(game)
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

describe('timed Day 1 shift (#22)', () => {
  const started = () => {
    const game = createGame(skin)
    startShift(game)
    return game
  }

  const addWaitingCustomer = (game: GameState, id: number, patience = skin.shift.customerPatience) => {
    game.customers.push({
      ...game.customers[0],
      id,
      look: id % skin.sprites.customers.length,
      served: false,
      missed: false,
      patience,
      order: { ...skin.shift.order },
      x: 900,
      y: 345,
      exit: 0,
    })
  }

  const serveFront = (game: GameState) => {
    game.counter.stock = 1
    game.counter.serveTimer = .66
    step(game, .05)
  }

  it('enters results exactly at zero, not one tick early', () => {
    const game = started()
    game.shift.remaining = .05
    step(game, .049)
    expect(game.phase).toBe('playing')
    expect(game.shift.remaining).toBeCloseTo(.001)
    step(game, .001)
    expect(game.phase).toBe('results')
    expect(game.shift.remaining).toBe(0)
  })

  it('walks a customer out at zero patience and resets the streak', () => {
    const game = started()
    game.shift.streak = 3
    game.shift.bestStreak = 3
    game.customers[0].patience = .05
    const startX = game.customers[0].x
    step(game, .05)
    expect(game.customers[0]).toMatchObject({ missed: true, patience: 0 })
    expect(game.customers[0].x).toBeGreaterThan(startX)
    expect(game.shift).toMatchObject({ missed: 1, streak: 0, bestStreak: 3 })
  })

  it('calculates deterministic tips and credits payout only when coins collect', () => {
    expect(tipFor(14, 14)).toBe(3)
    expect(tipFor(7, 14)).toBe(2)
    expect(tipFor(.01, 14)).toBe(1)
    expect(tipFor(0, 14)).toBe(0)

    const game = started()
    game.customers[0].patience = 7.05
    serveFront(game)
    const payout = skin.shift.basePrice + 2
    expect(game.events.find(event => event.kind === 'pay')?.amount).toBe(payout)
    expect(game.flyingCoins.reduce((total, coin) => total + coin.value, 0)).toBe(payout)
    expect(game.shift.revenue).toBe(0)
    Object.assign(game.player, { x: 55, y: 592 })
    runFor(game, 5)
    expect(game.shift.revenue).toBe(0)
    expect(game.flyingCoins).toHaveLength(4)
    Object.assign(game.player, { x: game.flyingCoins[0].x, y: game.flyingCoins[0].y + 55 })
    step(game, .01)
    expect(game.shift.revenue).toBeGreaterThan(0)
    expect(game.shift.revenue + game.flyingCoins.reduce((total, coin) => total + coin.value, 0)).toBe(payout)
  })

  it('increments consecutive serves and keeps the best when a miss resets it', () => {
    const game = started()
    serveFront(game)
    addWaitingCustomer(game, 2)
    serveFront(game)
    expect(game.shift).toMatchObject({ served: 2, streak: 2, bestStreak: 2 })
    addWaitingCustomer(game, 3, .05)
    step(game, .05)
    expect(game.shift).toMatchObject({ served: 2, missed: 1, streak: 0, bestStreak: 2 })
  })

  it('records failed and successful star results from skin thresholds', () => {
    const failed = started()
    failed.shift.revenue = skin.shift.cashGoal - 1
    runFor(failed, skin.shift.duration)
    expect(failed.phase).toBe('results')
    expect(goalMet(failed)).toBe(false)
    expect(failed.shift.stars).toBe(0)

    const passed = started()
    passed.shift.revenue = skin.shift.starThresholds[1]
    runFor(passed, skin.shift.duration)
    expect(goalMet(passed)).toBe(true)
    expect(passed.shift.stars).toBe(2)
    expect(passed.save).toMatchObject({ bestRevenue: skin.shift.starThresholds[1], bestStars: 2 })
  })

  it('retries with a fresh playing shift while preserving best results', () => {
    const game = started()
    game.shift.revenue = skin.shift.starThresholds[2]
    game.shift.served = 9
    game.machine.stock = 3
    runFor(game, skin.shift.duration)
    retryShift(game)
    expect(game.phase).toBe('playing')
    expect(game.time).toBe(0)
    expect(game.shift).toEqual({
      remaining: skin.shift.duration,
      revenue: 0,
      served: 0,
      missed: 0,
      streak: 0,
      bestStreak: 0,
      stars: 0,
    })
    expect(game.machine.stock).toBe(0)
    expect(game.save).toMatchObject({ bestRevenue: skin.shift.starThresholds[2], bestStars: 3 })
  })

  it('does not mutate after results', () => {
    const game = started()
    game.shift.remaining = .01
    step(game, .01)
    const frozen = structuredClone(game)
    step(game, .05, { x: 1, y: 1 })
    runFor(game, 20, { x: -1, y: 0 })
    expect(game).toEqual(frozen)
  })

  it('makes the goal achievable by a competent route and impossible by idling', () => {
    const idle = started()
    runFor(idle, skin.shift.duration)
    expect(idle.shift.revenue).toBe(0)
    expect(goalMet(idle)).toBe(false)

    const played = started()
    const moveTo = (target: Point) => {
      while (played.phase === 'playing') {
        const dx = target.x - played.player.x
        const dy = target.y - played.player.y
        const distance = Math.hypot(dx, dy)
        if (distance < 20) break
        step(played, .05, { x: dx / distance, y: dy / distance })
      }
    }
    while (played.phase === 'playing') {
      moveTo(stationPoint(skin, 'machine'))
      runFor(played, .8)
      moveTo(stationPoint(skin, 'counter'))
      runFor(played, .8)
    }
    expect(goalMet(played)).toBe(true)
    expect(played.shift.served).toBeGreaterThan(0)
  })
})
