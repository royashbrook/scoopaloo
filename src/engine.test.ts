import { describe, expect, it } from 'vitest'
import {
  currentDay,
  customerPatience,
  createGame,
  defaultSave,
  enterShop,
  goalMet,
  inventoryTotal,
  leaveShop,
  machineInterval,
  nextDay,
  producerInterval,
  purchaseUpgrade,
  retryShift,
  runFor,
  startShift,
  step,
  tipFor,
  trayCapacity,
  upgradeEffect,
  upgradeLevel,
  upgradeOffer,
  walkSpeed,
  type GameState,
  type Point,
} from './engine'
import type { GameSkin } from './skin'
import { itemFor, producerPoint, stationPoint } from './skin'
import skinData from './skins/ice-cream.json'

const skin = skinData as GameSkin

describe('ice cream stand loop', () => {
  it('takes interaction geometry from the selected skin', () => {
    expect(stationPoint(skin, 'machine')).toEqual({ x: skin.stations.machine.interaction[0], y: skin.stations.machine.interaction[1] })
    expect(stationPoint(skin, 'counter')).toEqual({ x: skin.stations.counter.interaction[0], y: skin.stations.counter.interaction[1] })
    expect(producerPoint(skin, 'sundae-cart')).toEqual({ x: 620, y: 335 })
  })

  it('produces, carries, serves, and pays', () => {
    const game = createGame(skin)
    startShift(game)
    runFor(game, 2)
    Object.assign(game.player, producerPoint(skin, skin.progression.startingStation))
    runFor(game, 4)
    expect(game.player.tray).toBeGreaterThan(0)

    Object.assign(game.player, stationPoint(skin, 'counter'))
    runFor(game, 2)
    expect(game.counter.stock + game.flyingCoins.length + game.save.lifetimeCash).toBeGreaterThan(0)

    Object.assign(game.player, stationPoint(skin, 'register'))
    runFor(game, 4)
    expect(game.save.lifetimeCash).toBeGreaterThan(0)

  })
})

describe('three-day shop campaign (#25)', () => {
  const finishAt = (game: GameState, revenue: number) => {
    if (game.phase === 'ready') startShift(game)
    game.shift.revenue = revenue
    game.shift.remaining = .01
    step(game, .01)
  }

  it('keeps days and all twelve cumulative upgrade levels in skin data', () => {
    expect(skin.days).toHaveLength(3)
    expect(skin.days.map(day => day.cashGoal)).toEqual([60, 100, 130])
    expect(skin.days.map(day => day.customerPatience)).toEqual([24, 20, 17])
    expect(skin.days.map(day => day.spawnInterval)).toEqual([3.8, 3.2, 2.8])
    expect(skin.days.every(day => day.challenge && day.unlockBanner && day.orderDeck.length > 0)).toBe(true)
    expect(skin.upgrades.map(upgrade => upgrade.levels.length)).toEqual([3, 3, 3, 3])
    expect(skin.upgrades.map(upgrade => upgrade.levels[0].price)).toEqual([35, 50, 80, 120])
  })

  it('offers independent cards and purchases only inside the shop', () => {
    const game = createGame(skin)
    game.save.coins = 79
    const [shoes, tray, machine, patience] = skin.upgrades
    expect([shoes, tray, machine, patience].map(upgrade => upgradeOffer(game, upgrade).affordable))
      .toEqual([true, true, false, false])
    expect(purchaseUpgrade(game, shoes.id)).toBe(false)

    finishAt(game, currentDay(game).cashGoal)
    expect(enterShop(game)).toBe(true)
    expect(upgradeOffer(game, shoes)).toEqual({
      level: 0, price: 35, before: 0, after: 25, affordable: true, capped: false,
    })
    expect(purchaseUpgrade(game, shoes.id)).toBe(true)
    expect(game.save).toMatchObject({ coins: 44, upgrades: { shoes: 1 } })
    expect(upgradeOffer(game, shoes)).toMatchObject({ level: 1, price: 85, before: 25, after: 50, affordable: false })
    expect(leaveShop(game)).toBe(true)
    expect(purchaseUpgrade(game, tray.id)).toBe(false)
  })

  it('caps levels and applies every effect to the live rules', () => {
    const game = createGame(skin)
    finishAt(game, currentDay(game).cashGoal)
    enterShop(game)
    game.save.coins = 999
    const shoes = skin.upgrades[0]
    expect([purchaseUpgrade(game, shoes.id), purchaseUpgrade(game, shoes.id), purchaseUpgrade(game, shoes.id)])
      .toEqual([true, true, true])
    expect(purchaseUpgrade(game, shoes.id)).toBe(false)
    expect(upgradeOffer(game, shoes)).toEqual({ level: 3, price: null, before: 75, after: 75, affordable: false, capped: true })

    Object.assign(game.save.upgrades, { tray: 1, machine: 1, patience: 1 })
    expect(upgradeLevel(game.save, 'shoes')).toBe(3)
    expect(upgradeEffect(game, 'walkSpeed')).toBe(75)
    expect(walkSpeed(game)).toBe(260)
    expect(trayCapacity(game)).toBe(3)
    expect(customerPatience(game)).toBe(currentDay(game).customerPatience + 1.5)
    for (const source of Object.keys(skin.producers)) {
      expect(producerInterval(game, source)).toBeCloseTo(skin.producers[source].interval - .45)
    }
    expect(machineInterval(game)).toBe(producerInterval(game, skin.progression.startingStation))
  })

  it('records each day, gates advancement through the shop, and replays Day 3', () => {
    const game = createGame(skin)
    finishAt(game, skin.days[0].starThresholds[1])
    expect(game.save.dayBestRevenue).toEqual([75, 0, 0])
    expect(game.save.dayStars).toEqual([2, 0, 0])
    expect(nextDay(game)).toBe(false)
    enterShop(game)
    expect(nextDay(game)).toBe(true)
    expect(game).toMatchObject({ phase: 'ready', save: { currentDay: 1 }, nextOrder: 1 })
    expect(currentDay(game).id).toBe(skin.days[1].id)
    expect(game.customers[0].order).toMatchObject(skin.days[1].orderDeck[0])

    finishAt(game, skin.days[1].cashGoal - 1)
    enterShop(game)
    expect(nextDay(game)).toBe(false)
    expect(retryShift(game)).toBe(true)
    expect(game).toMatchObject({ phase: 'playing', save: { currentDay: 1 }, nextOrder: 1 })
    finishAt(game, skin.days[1].cashGoal)
    enterShop(game)
    expect(nextDay(game)).toBe(true)
    expect(game.save.currentDay).toBe(2)

    finishAt(game, skin.days[2].cashGoal)
    enterShop(game)
    expect(nextDay(game)).toBe(true)
    expect(game).toMatchObject({ phase: 'ready', save: { currentDay: 2 }, nextOrder: 1 })
  })
})

describe('typed mixed orders (#24)', () => {
  const started = () => {
    const game = createGame(skin)
    startShift(game)
    return game
  }

  const orderAt = (index: number) => {
    const request = skin.orderDeck[index]
    const item = itemFor(skin, request.item)
    return { ...request, label: item.label, price: item.price * request.quantity, icon: item.icon, color: item.color }
  }

  it('keeps item definitions, producer art geometry, and the order deck in skin data', () => {
    expect(Object.keys(skin.items)).toHaveLength(2)
    expect(new Set(Object.values(skin.items).map(item => item.recipe.source)).size).toBe(2)
    expect(Object.values(skin.items).every(item => item.icon.startsWith('/assets/items/'))).toBe(true)
    expect(skin.orderDeck.slice(0, 2)).toEqual([
      { item: 'vanilla-cone', quantity: 1 },
      { item: 'vanilla-cone', quantity: 1 },
    ])
    expect(skin.orderDeck.slice(2)).toHaveLength(6)
  })

  it('picks up and drops typed stock from two distinct producers', () => {
    const game = started()
    for (const source of Object.values(game.sources)) source.stock = 1

    Object.assign(game.player, producerPoint(skin, itemFor(skin, 'vanilla-cone').recipe.source))
    step(game, .05)
    Object.assign(game.player, producerPoint(skin, itemFor(skin, 'sundae').recipe.source))
    runFor(game, .4)

    expect(game.player.trayItems).toMatchObject({ 'vanilla-cone': 1, sundae: 1 })
    expect(game.player.tray).toBe(2)

    Object.assign(game.player, stationPoint(skin, 'counter'))
    runFor(game, .8)
    expect(game.counter.items).toMatchObject({ 'vanilla-cone': 1, sundae: 1 })
    expect(game.counter.stock).toBe(2)
    expect(game.player.tray).toBe(0)
  })

  it('rejects wrong stock without consuming the item or customer patience', () => {
    const game = started()
    const front = game.customers[0]
    game.player.trayItems.sundae = 1
    game.player.tray = 1
    Object.assign(game.player, stationPoint(skin, 'counter'))
    const patience = front.patience

    step(game, .05)

    expect(game.events).toContainEqual(expect.objectContaining({
      kind: 'reject',
      item: 'sundae',
      expectedItem: front.order.item,
    }))
    expect(game.counter.items.sundae).toBe(1)
    expect(front.served).toBe(false)
    expect(front.patience).toBeCloseTo(patience - .05)
    runFor(game, .8)
    expect(game.counter.items.sundae).toBe(1)
    expect(front.served).toBe(false)
  })

  it('consumes only the requested product and mixed quantity', () => {
    const game = started()
    const front = game.customers[0]
    front.order = orderAt(3)
    game.counter.items = { 'vanilla-cone': 1, sundae: 1 }
    game.counter.stock = inventoryTotal(game.counter.items)
    runFor(game, .8)
    expect(front.served).toBe(false)
    expect(game.counter.items).toEqual({ 'vanilla-cone': 1, sundae: 1 })

    game.counter.items['vanilla-cone']++
    game.counter.stock++
    runFor(game, .8)
    expect(front.served).toBe(true)
    expect(game.counter.items).toEqual({ 'vanilla-cone': 0, sundae: 1 })
    expect(game.events.find(event => event.kind === 'pay')).toMatchObject({
      item: 'vanilla-cone',
      amount: expect.any(Number),
    })
  })

  it('deals a deterministic sequence and wraps without depending on live customers', () => {
    const game = started()
    const orders = [game.customers[0].order]
    for (let index = 1; index < skin.orderDeck.length + 2; index++) {
      game.customers = []
      game.spawnTimer = 0
      step(game, .05)
      orders.push(game.customers[0].order)
    }
    expect(orders.map(({ item, quantity }) => ({ item, quantity }))).toEqual([
      ...skin.orderDeck,
      ...skin.orderDeck.slice(0, 2),
    ])
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
      order: { ...game.customers[0].order },
      x: 900,
      y: 345,
      exit: 0,
    })
  }

  const serveFront = (game: GameState) => {
    const front = game.customers.find(customer => !customer.served && !customer.missed)
    if (!front) throw new Error('no waiting customer')
    game.counter.items[front.order.item] = front.order.quantity
    game.counter.stock = inventoryTotal(game.counter.items)
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
    game.customers[0].patience = skin.shift.customerPatience / 2 + .05
    const basePrice = game.customers[0].order.price
    serveFront(game)
    const payout = basePrice + 2
    expect(game.events.find(event => event.kind === 'pay')?.amount).toBe(payout)
    expect(game.events.find(event => event.kind === 'pay')?.tip).toBe(2)
    expect(game.flyingCoins.reduce((total, coin) => total + coin.value, 0)).toBe(payout)
    expect(game.shift.revenue).toBe(0)
    Object.assign(game.player, { x: 55, y: 592 })
    runFor(game, 5)
    expect(game.shift.revenue).toBe(0)
    expect(game.flyingCoins).toHaveLength(4)
    Object.assign(game.player, { x: game.flyingCoins[0].x, y: game.flyingCoins[0].y + 55 })
    step(game, .01)
    expect(game.shift.revenue).toBeGreaterThan(0)
    expect([game.save.coins, game.save.lifetimeCash]).toEqual([game.shift.revenue, game.shift.revenue])
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

  it('keeps a purchased-upgrade route beatable across all days and better than camping one source', () => {
    const idle = started()
    runFor(idle, skin.shift.duration)
    expect(idle.shift.revenue).toBe(0)
    expect(goalMet(idle)).toBe(false)

    const play = (
      dayIndex: number,
      chooseSource: (game: GameState) => string,
      openingDelay = 0,
      upgrades: Record<string, number> = {},
    ) => {
      const save = defaultSave(skin)
      save.currentDay = dayIndex
      Object.assign(save.upgrades, upgrades)
      const game = createGame(skin, save)
      startShift(game)
      runFor(game, openingDelay)
      const moveTo = (target: Point) => {
        while (game.phase === 'playing') {
          const dx = target.x - game.player.x
          const dy = target.y - game.player.y
          const distance = Math.hypot(dx, dy)
          if (distance < 20) break
          step(game, .05, { x: dx / distance, y: dy / distance })
        }
      }
      while (game.phase === 'playing') {
        const front = game.customers.find(customer => !customer.served && !customer.missed)
        if (!front) {
          runFor(game, .1)
          continue
        }
        const source = chooseSource(game)
        moveTo(producerPoint(skin, source))
        while (game.phase === 'playing' && !front.served && !front.missed
          && (game.player.trayItems[front.order.item] ?? 0) < front.order.quantity) {
          runFor(game, .2)
          if (source !== itemFor(skin, front.order.item).recipe.source) break
        }
        moveTo(stationPoint(skin, 'counter'))
        runFor(game, 1.4)
      }
      return game
    }

    const followOrder = (game: GameState) => {
      const front = game.customers.find(customer => !customer.served && !customer.missed)
      if (!front) return skin.progression.startingStation
      return itemFor(skin, front.order.item).recipe.source
    }
    const played = play(0, followOrder, 4)
    const camped = play(0, () => skin.progression.startingStation)
    const campaign = [
      played,
      play(1, followOrder, 0, { shoes: 1 }),
      play(2, followOrder, 0, { shoes: 1, tray: 1, machine: 1 }),
    ]

    expect(goalMet(played)).toBe(true)
    expect(played.shift.served).toBeGreaterThan(0)
    expect(played.shift.missed).toBeGreaterThan(0)
    expect(camped.shift.revenue).toBeLessThan(played.shift.revenue)
    expect(camped.shift.served).toBeLessThan(played.shift.served)
    expect(camped.shift.stars).toBeLessThan(played.shift.stars)
    expect(campaign.map(game => game.shift.revenue)).toEqual([79, 111, 218])
    expect(campaign.every(goalMet)).toBe(true)
  })
})
