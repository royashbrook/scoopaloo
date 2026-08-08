import { describe, expect, it } from 'vitest'
import {
  comboBonus,
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
  prepSeconds,
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
  upcomingOrders,
  walkSpeed,
  type GameState,
  type Point,
} from './engine'
import type { GameSkin } from './skin'
import { itemFor, prepPoint, producerPoint, stationPoint } from './skin'
import skinData from './skins/ice-cream.json'

const skin = skinData as GameSkin
const firstDay = skin.days[0]

describe('ice cream stand loop', () => {
  it('takes interaction geometry from the selected skin', () => {
    expect(prepPoint(skin, 'build-station')).toEqual({ x: 480, y: 730 })
    expect(stationPoint(skin, 'counter')).toEqual({ x: skin.stations.counter.interaction[0], y: skin.stations.counter.interaction[1] })
    expect(producerPoint(skin, 'soft-scoop')).toEqual({ x: 360, y: 1070 })
    expect(producerPoint(skin, 'chocolate-scoop')).toEqual({ x: 600, y: 1070 })
    expect(producerPoint(skin, 'cone-shell')).toEqual({ x: 270, y: 920 })
    expect(producerPoint(skin, 'sundae-cup')).toEqual({ x: 690, y: 920 })
  })

  it('collects components, prepares a product, serves, and pays', () => {
    const game = createGame(skin)
    startShift(game)
    runFor(game, 2)
    Object.assign(game.player, producerPoint(skin, 'soft-scoop'))
    step(game, .05)
    Object.assign(game.player, producerPoint(skin, 'cone-shell'))
    runFor(game, .7)
    expect(game.player.trayItems).toMatchObject({ 'soft-scoop': 1, 'cone-shell': 1 })

    Object.assign(game.player, prepPoint(skin, 'build-station'))
    runFor(game, 2.3)
    expect(game.player.trayItems['vanilla-cone']).toBe(1)

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
    expect(skin.days.map(day => day.cashGoal)).toEqual([45, 60, 70])
    expect(skin.days.map(day => day.customerPatience)).toEqual([50, 32, 60])
    expect(skin.days.map(day => day.spawnInterval)).toEqual([10, 8.5, 7.5])
    expect(skin.days[2].starThresholds).toEqual([70, 130, 190])
    expect(skin.days[2].spawnInterval).toBeLessThanOrEqual(skin.days[1].spawnInterval)
    expect(skin.days.every(day => day.challenge && day.unlockBanner && day.orderDeck.length > 0)).toBe(true)
    expect(skin.days[1]).toMatchObject({ challenge: 'CHOCOLATE RUSH', unlockStations: ['chocolate-scoop'] })
    expect(skin.days[2].challenge).toBe('FULL MENU FINALE')
    expect([...new Set(skin.days[0].orderDeck.map(order => order.item))]).toEqual(['vanilla-cone', 'sundae'])
    expect(skin.days[1].orderDeck).toEqual([
      { item: 'chocolate-cone', quantity: 1 },
      { item: 'vanilla-cone', quantity: 1 },
      { item: 'sundae', quantity: 1 },
      { item: 'chocolate-sundae', quantity: 1 },
      { item: 'chocolate-cone', quantity: 2 },
      { item: 'vanilla-cone', quantity: 2 },
      { item: 'chocolate-sundae', quantity: 2 },
      { item: 'sundae', quantity: 2 },
    ])
    expect(skin.upgrades.map(upgrade => upgrade.levels.length)).toEqual([3, 3, 3, 3])
    expect(skin.upgrades.map(upgrade => upgrade.levels[0].price)).toEqual([25, 40, 80, 20])
  })

  it('offers independent cards and purchases only inside the shop', () => {
    const game = createGame(skin)
    game.save.coins = 48
    const [shoes, tray, machine, patience] = skin.upgrades
    expect([shoes, tray, machine, patience].map(upgrade => upgradeOffer(game, upgrade).affordable))
      .toEqual([true, true, false, true])
    expect(purchaseUpgrade(game, shoes.id)).toBe(false)

    finishAt(game, currentDay(game).cashGoal)
    expect(enterShop(game)).toBe(true)
    expect(upgradeOffer(game, shoes)).toEqual({
      level: 0, price: 25, before: 0, after: 60, affordable: true, capped: false,
    })
    expect(purchaseUpgrade(game, shoes.id)).toBe(true)
    expect(game.save).toMatchObject({ coins: 23, upgrades: { shoes: 1 } })
    expect(upgradeOffer(game, shoes)).toMatchObject({ level: 1, price: 35, before: 60, after: 110, affordable: false })
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
    expect(upgradeOffer(game, shoes)).toEqual({ level: 3, price: null, before: 160, after: 160, affordable: false, capped: true })

    Object.assign(game.save.upgrades, { tray: 1, machine: 1, patience: 1 })
    expect(upgradeLevel(game.save, 'shoes')).toBe(3)
    expect(upgradeEffect(game, 'walkSpeed')).toBe(160)
    expect(walkSpeed(game)).toBe(345)
    expect(trayCapacity(game)).toBe(4)
    expect(customerPatience(game)).toBe(currentDay(game).customerPatience + 8)
    for (const source of Object.keys(skin.producers)) {
      expect(producerInterval(game, source)).toBe(skin.producers[source].interval)
    }
    expect(prepSeconds(game, 'vanilla-cone')).toBeCloseTo(itemFor(skin, 'vanilla-cone').recipe!.seconds - .65)
    expect(machineInterval(game)).toBe(producerInterval(game, skin.progression.startingStation))
  })

  it('records each day, gates advancement through the shop, and replays Day 3', () => {
    const game = createGame(skin)
    finishAt(game, skin.days[0].starThresholds[1])
    expect(game.save.dayBestRevenue).toEqual([60, 0, 0])
    expect(game.save.dayStars).toEqual([2, 0, 0])
    expect(nextDay(game)).toBe(false)
    enterShop(game)
    expect(nextDay(game)).toBe(true)
    expect(game).toMatchObject({
      phase: 'ready',
      save: { currentDay: 1, unlockedStations: expect.arrayContaining(['chocolate-scoop']) },
      nextOrder: 1,
      sources: { 'chocolate-scoop': { item: 'chocolate-scoop' } },
    })
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

describe('manual typed preparation', () => {
  const started = (day = 0) => {
    const save = defaultSave(skin)
    save.currentDay = day
    const game = createGame(skin, save)
    startShift(game)
    return game
  }

  it('locks chocolate on Day 1 and backfills it into an existing Day 2 SaveV1', () => {
    const game = started()
    expect(Object.keys(game.sources)).toEqual(['soft-scoop', 'cone-shell', 'sundae-cup'])
    expect(Object.fromEntries(Object.entries(game.sources).map(([id, source]) => [id, source.item])))
      .toEqual({ 'soft-scoop': 'soft-scoop', 'cone-shell': 'cone-shell', 'sundae-cup': 'sundae-cup' })
    Object.assign(game.player, producerPoint(skin, 'chocolate-scoop'))
    runFor(game, 2.5)
    expect(game.player.trayItems['chocolate-scoop']).toBe(0)

    const legacy = defaultSave(skin)
    legacy.currentDay = 1
    legacy.unlockedStations.push('retired-cart')
    const restored = createGame(skin, legacy)
    expect(restored.sources['chocolate-scoop']).toMatchObject({ item: 'chocolate-scoop', stock: 0 })
    expect(restored.save.unlockedStations).toEqual([
      ...skin.progression.startingStations, 'retired-cart', 'chocolate-scoop',
    ])
    expect(legacy.unlockedStations).not.toContain('chocolate-scoop')
  })

  it('defines the four flavor-by-vessel recipes directly in skin data', () => {
    expect(Object.values(skin.items).filter(item => !item.recipe).every(item => item.price === 0)).toBe(true)
    expect(Object.fromEntries(['vanilla-cone', 'sundae', 'chocolate-cone', 'chocolate-sundae']
      .map(item => [item, itemFor(skin, item).recipe?.inputs]))).toEqual({
      'vanilla-cone': { 'soft-scoop': 1, 'cone-shell': 1 },
      sundae: { 'soft-scoop': 1, 'sundae-cup': 1 },
      'chocolate-cone': { 'chocolate-scoop': 1, 'cone-shell': 1 },
      'chocolate-sundae': { 'chocolate-scoop': 1, 'sundae-cup': 1 },
    })
    expect(['vanilla-cone', 'sundae', 'chocolate-cone', 'chocolate-sundae']
      .map(item => itemFor(skin, item).recipe?.station)).toEqual(Array(4).fill('build-station'))
    expect(['vanilla-cone', 'sundae', 'chocolate-cone', 'chocolate-sundae']
      .map(item => [skin.items[item].label, skin.items[item].price])).toEqual([
      ['VANILLA CONE', 10], ['VANILLA SUNDAE', 13],
      ['CHOCOLATE CONE', 12], ['CHOCOLATE SUNDAE', 15],
    ])
  })

  it('takes one component per source entry so a two-slot tray can mix ingredients', () => {
    const game = started()
    game.sources['soft-scoop'].stock = 2
    Object.assign(game.player, producerPoint(skin, 'soft-scoop'))
    step(game, .05)
    runFor(game, 1)
    expect(game.player.trayItems['soft-scoop']).toBe(1)

    Object.assign(game.player, { x: 480, y: 880 })
    step(game, .05)
    Object.assign(game.player, producerPoint(skin, 'soft-scoop'))
    runFor(game, .7)
    expect(game.player.trayItems['soft-scoop']).toBe(2)
  })

  it('chooses the front order and consumes exactly its inputs atomically', () => {
    const game = started()
    game.save.upgrades.tray = 2
    Object.assign(game.player.trayItems, { 'soft-scoop': 2, 'cone-shell': 1, 'sundae-cup': 1 })
    game.player.tray = inventoryTotal(game.player.trayItems)
    Object.assign(game.player, prepPoint(skin, 'build-station'))

    step(game, .05)

    expect(game.prepStations['build-station'].job).toEqual({ item: 'vanilla-cone', remaining: 1 })
    expect(game.player.trayItems).toMatchObject({ 'soft-scoop': 1, 'cone-shell': 0, 'sundae-cup': 1 })
    expect(game.events).toContainEqual(expect.objectContaining({
      kind: 'prep-start', station: 'build-station', item: 'vanilla-cone',
    }))
  })

  it('chooses the first satisfiable queued order before skin insertion order', () => {
    const game = started(1)
    const order = (item: string) => ({
      item,
      quantity: 1,
      label: skin.items[item].label,
      price: skin.items[item].price,
      icon: skin.items[item].icon,
      color: skin.items[item].color,
    })
    game.customers[0].order = order('chocolate-cone')
    game.customers.push({ ...game.customers[0], id: 99, order: order('chocolate-sundae') })
    game.save.upgrades.tray = 2
    Object.assign(game.player.trayItems, {
      'soft-scoop': 1, 'chocolate-scoop': 1, 'sundae-cup': 2,
    })
    game.player.tray = inventoryTotal(game.player.trayItems)
    Object.assign(game.player, prepPoint(skin, 'build-station'))

    step(game, .05)

    expect(game.prepStations['build-station'].job?.item).toBe('chocolate-sundae')
    expect(game.player.trayItems).toMatchObject({
      'soft-scoop': 1, 'chocolate-scoop': 0, 'sundae-cup': 1,
    })
  })

  it('chooses a satisfiable unspawned NEXT preview before skin insertion order', () => {
    const game = started(1)
    const order = (item: string) => ({
      item,
      quantity: 1,
      label: skin.items[item].label,
      price: skin.items[item].price,
      icon: skin.items[item].icon,
      color: skin.items[item].color,
    })
    game.customers[0].order = order('sundae')
    game.nextOrder = 4
    game.save.upgrades.tray = 1
    Object.assign(game.player.trayItems, {
      'soft-scoop': 1, 'chocolate-scoop': 1, 'cone-shell': 1,
    })
    game.player.tray = inventoryTotal(game.player.trayItems)
    Object.assign(game.player, prepPoint(skin, 'build-station'))

    expect(upcomingOrders(game, 1)[0]?.item).toBe('chocolate-cone')
    step(game, .05)

    expect(game.prepStations['build-station'].job?.item).toBe('chocolate-cone')
    expect(game.player.trayItems).toMatchObject({
      'soft-scoop': 1, 'chocolate-scoop': 0, 'cone-shell': 0,
    })
  })

  it('leaves incomplete and unrelated inventory untouched', () => {
    const game = started()
    Object.assign(game.player.trayItems, { 'soft-scoop': 1, 'sundae-cup': 0 })
    game.player.tray = 1
    Object.assign(game.player, prepPoint(skin, 'build-station'))
    const before = structuredClone(game.player.trayItems)

    step(game, .05)

    expect(game.prepStations['build-station'].job).toBeNull()
    expect(game.player.trayItems).toEqual(before)
    expect(game.events.some(event => event.kind === 'prep-start')).toBe(false)
  })

  it('pauses deterministic dwell work, buffers completion, and waits for tray room', () => {
    const game = started()
    Object.assign(game.player.trayItems, { 'soft-scoop': 1, 'cone-shell': 1 })
    game.player.tray = 2
    Object.assign(game.player, prepPoint(skin, 'build-station'))
    step(game, .05)
    const seconds = prepSeconds(game, 'vanilla-cone')

    Object.assign(game.player, { x: 480, y: 880 })
    runFor(game, .5)
    expect(game.prepStations['build-station'].job?.remaining).toBe(seconds)

    Object.assign(game.player, prepPoint(skin, 'build-station'))
    runFor(game, seconds)
    expect(game.prepStations['build-station']).toMatchObject({ job: null, outputs: { 'vanilla-cone': 1 } })
    expect(game.events).toContainEqual(expect.objectContaining({
      kind: 'prep-ready', station: 'build-station', item: 'vanilla-cone',
    }))

    game.player.trayItems['cone-shell'] = 2
    game.player.tray = 2
    runFor(game, .4)
    expect(game.prepStations['build-station'].outputs['vanilla-cone']).toBe(1)
    game.player.trayItems['cone-shell'] = 1
    game.player.tray = 1
    step(game, .05)
    expect(game.prepStations['build-station'].outputs['vanilla-cone']).toBe(0)
    expect(game.player.trayItems['vanilla-cone']).toBe(1)
  })

  it('keeps raw components on the tray and preserves wrong finished stock at the counter', () => {
    const raw = started()
    raw.player.trayItems['soft-scoop'] = 1
    raw.player.tray = 1
    Object.assign(raw.player, stationPoint(skin, 'counter'))
    step(raw, .05)
    expect(raw.player.trayItems['soft-scoop']).toBe(1)
    expect(raw.counter.stock).toBe(0)
    expect(raw.events).toContainEqual(expect.objectContaining({
      kind: 'reject', item: 'soft-scoop', reason: 'needs-prep',
    }))

    const wrong = started()
    const front = wrong.customers[0]
    wrong.player.trayItems.sundae = 1
    wrong.player.tray = 1
    Object.assign(wrong.player, stationPoint(skin, 'counter'))
    step(wrong, .05)
    expect(wrong.counter.items.sundae).toBe(1)
    expect(wrong.events).toContainEqual(expect.objectContaining({
      kind: 'reject', item: 'sundae', expectedItem: front.order.item, reason: 'wrong-item',
    }))
  })

  it('keeps a full buildable recipe intact at the counter', () => {
    const game = started()
    Object.assign(game.player.trayItems, { 'soft-scoop': 1, 'cone-shell': 1 })
    game.player.tray = 2
    Object.assign(game.player, stationPoint(skin, 'counter'))

    step(game, .05)

    expect(game.player.trayItems).toMatchObject({ 'soft-scoop': 1, 'cone-shell': 1 })
    expect(game.events).toContainEqual(expect.objectContaining({
      kind: 'reject', item: 'soft-scoop', reason: 'needs-prep',
    }))
  })

  it('returns one component when a buildable tray is blocked by reserved prep capacity', () => {
    const game = started()
    Object.assign(game.player.trayItems, { 'soft-scoop': 1, 'cone-shell': 1 })
    game.player.tray = 2
    game.prepStations['build-station'].outputs.sundae = 1
    game.prepStations['build-station'].job = { item: 'vanilla-cone', remaining: .5 }
    Object.assign(game.player, stationPoint(skin, 'counter'))
    const stockBefore = game.sources['soft-scoop'].stock

    step(game, .05)

    expect(game.player.trayItems).toMatchObject({ 'soft-scoop': 0, 'cone-shell': 1 })
    expect(game.sources['soft-scoop'].stock).toBe(stockBefore + 1)
    expect(game.events.filter(event => event.reason === 'returned-raw')).toHaveLength(1)
  })

  it('returns one incompatible component from a full tray and can recover', () => {
    const game = started()
    Object.assign(game.player.trayItems, { 'cone-shell': 1, 'sundae-cup': 1 })
    game.player.tray = 2
    Object.assign(game.player, stationPoint(skin, 'counter'))
    const stockBefore = game.sources['sundae-cup'].stock

    step(game, .05)

    expect(game.player.trayItems).toMatchObject({ 'cone-shell': 1, 'sundae-cup': 0 })
    expect(game.sources['sundae-cup'].stock).toBe(stockBefore + 1)
    expect(game.events).toContainEqual(expect.objectContaining({
      kind: 'reject', item: 'sundae-cup', source: 'sundae-cup', reason: 'returned-raw',
    }))

    game.sources['soft-scoop'].stock = 1
    Object.assign(game.player, producerPoint(skin, 'soft-scoop'))
    runFor(game, .7)
    Object.assign(game.player, prepPoint(skin, 'build-station'))
    runFor(game, 2.6)
    expect(game.player.trayItems['vanilla-cone']).toBe(1)
  })

  it('returns an excess recipe component before the useful set', () => {
    const game = started()
    game.save.upgrades.tray = 1
    Object.assign(game.player.trayItems, { 'soft-scoop': 1, 'cone-shell': 3 })
    game.player.tray = 4
    game.prepStations['build-station'].outputs.sundae = 1
    game.prepStations['build-station'].job = { item: 'vanilla-cone', remaining: .5 }
    Object.assign(game.player, stationPoint(skin, 'counter'))

    step(game, .05)

    expect(game.player.trayItems).toMatchObject({ 'soft-scoop': 1, 'cone-shell': 2 })
    expect(game.events).toContainEqual(expect.objectContaining({
      kind: 'reject', item: 'cone-shell', source: 'cone-shell', reason: 'returned-raw',
    }))
  })

  it('falls back to stable skin order when no customer is waiting', () => {
    const game = started()
    game.customers = []
    game.save.upgrades.tray = 2
    Object.assign(game.player.trayItems, { 'soft-scoop': 2, 'cone-shell': 1, 'sundae-cup': 1 })
    game.player.tray = 4
    Object.assign(game.player, prepPoint(skin, 'build-station'))
    step(game, .05)
    expect(game.prepStations['build-station'].job?.item).toBe('vanilla-cone')
  })
})

describe('timed Day 1 shift (#22)', () => {
  const started = () => {
    const game = createGame(skin)
    startShift(game)
    return game
  }

  const addWaitingCustomer = (game: GameState, id: number, patience = firstDay.customerPatience) => {
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

  const orderKeys = (game: GameState, count = 2) => upcomingOrders(game, count)
    .map(order => `${order.item}:${order.quantity}`)
  const deckKey = (index: number) => {
    const order = firstDay.orderDeck[index % firstDay.orderDeck.length]
    return `${order.item}:${order.quantity}`
  }

  it('previews two future orders without duplicating a spawned customer', () => {
    const game = started()
    const firstPreview = [deckKey(1), deckKey(2)]
    expect(orderKeys(game)).toEqual(firstPreview)

    game.spawnTimer = .05
    step(game, .05)
    expect(orderKeys(game)).toEqual(firstPreview)

    serveFront(game)
    game.spawnTimer = .05
    step(game, .05)
    expect(orderKeys(game)).toEqual([deckKey(2), deckKey(3)])

    const front = game.customers.find(customer => !customer.served && !customer.missed)
    if (!front) throw new Error('no waiting customer')
    front.patience = .05
    step(game, .05)
    expect(orderKeys(game)).toEqual([deckKey(3), deckKey(4)])
  })

  it('wraps future previews through the skin order deck', () => {
    const game = started()
    game.nextOrder = firstDay.orderDeck.length - 1
    expect(orderKeys(game, 3)).toEqual([
      deckKey(firstDay.orderDeck.length - 1),
      deckKey(0),
      deckKey(1),
    ])
  })

  it('applies exact data-driven combo boundaries to payout before coin splitting', () => {
    const game = started()
    expect(Array.from({ length: 8 }, (_, streak) => comboBonus(game, streak)))
      .toEqual([0, 0, 2, 2, 4, 4, 6, 6])

    game.shift.streak = 1
    game.customers[0].patience = firstDay.customerPatience / 2 + .05
    const basePrice = game.customers[0].order.price
    serveFront(game)

    const payout = basePrice + 2 + 2
    expect(game.events.find(event => event.kind === 'pay')).toMatchObject({
      amount: payout,
      tip: 2,
      combo: 2,
      streak: 2,
    })
    expect(game.flyingCoins.reduce((total, coin) => total + coin.value, 0)).toBe(payout)
  })

  it('makes six uninterrupted serves worth $10 more than a broken 3 + 3 run', () => {
    const game = started()
    const bonus = (streaks: number[]) => streaks.reduce((total, streak) => total + comboBonus(game, streak), 0)
    expect(bonus([1, 2, 3, 4, 5, 6])).toBe(18)
    expect(bonus([1, 2, 3, 1, 2, 3])).toBe(8)
  })

  it('emits one combo break for simultaneous walkouts and none without a streak', () => {
    const broken = started()
    broken.shift.streak = 4
    broken.shift.bestStreak = 4
    broken.customers[0].patience = .05
    addWaitingCustomer(broken, 2, .05)
    step(broken, .05)
    expect(broken.events.filter(event => event.kind === 'combo-break')).toEqual([
      expect.objectContaining({ kind: 'combo-break', streak: 4 }),
    ])

    const empty = started()
    empty.customers[0].patience = .05
    step(empty, .05)
    expect(empty.events.some(event => event.kind === 'combo-break')).toBe(false)
  })

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
    expect(game.events.filter(event => event.kind === 'combo-break')).toEqual([
      expect.objectContaining({ kind: 'combo-break', streak: 3 }),
    ])
  })

  it('calculates deterministic tips and credits payout only when coins collect', () => {
    expect(tipFor(14, 14)).toBe(3)
    expect(tipFor(7, 14)).toBe(2)
    expect(tipFor(.01, 14)).toBe(1)
    expect(tipFor(0, 14)).toBe(0)

    const game = started()
    game.customers[0].patience = firstDay.customerPatience / 2 + .05
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
    failed.shift.revenue = firstDay.cashGoal - 1
    runFor(failed, firstDay.duration)
    expect(failed.phase).toBe('results')
    expect(goalMet(failed)).toBe(false)
    expect(failed.shift.stars).toBe(0)

    const passed = started()
    passed.shift.revenue = firstDay.starThresholds[1]
    runFor(passed, firstDay.duration)
    expect(goalMet(passed)).toBe(true)
    expect(passed.shift.stars).toBe(2)
    expect(passed.save).toMatchObject({ bestRevenue: firstDay.starThresholds[1], bestStars: 2 })
  })

  it('retries with a fresh playing shift while preserving best results', () => {
    const game = started()
    game.shift.revenue = firstDay.starThresholds[2]
    game.shift.served = 9
    game.machine.stock = 3
    runFor(game, firstDay.duration)
    retryShift(game)
    expect(game.phase).toBe('playing')
    expect(game.time).toBe(0)
    expect(game.shift).toEqual({
      remaining: firstDay.duration,
      revenue: 0,
      served: 0,
      missed: 0,
      streak: 0,
      bestStreak: 0,
      stars: 0,
    })
    expect(game.machine.stock).toBe(0)
    expect(game.save).toMatchObject({ bestRevenue: firstDay.starThresholds[2], bestStars: 3 })
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

  it('pins the first deterministic manual-route balance baseline', () => {
    const idle = started()
    runFor(idle, firstDay.duration)
    expect(idle.shift.revenue).toBe(0)
    expect(goalMet(idle)).toBe(false)

    const playGame = (game: GameState, openingDelay = 0) => {
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
      const routeTo = (target: Point) => {
        // Flavor machines sit behind the vessel row. Use the center aisle so
        // this deterministic route models a deliberate choice, not a drive-by pickup.
        if (target.y > 1000) {
          moveTo({ x: 480, y: game.player.y })
          moveTo({ x: 480, y: target.y })
          moveTo(target)
          return
        }
        moveTo({ x: game.player.x, y: 880 })
        moveTo({ x: target.x, y: 880 })
        moveTo(target)
      }
      const sourceFor = (ingredient: string) => {
        const source = Object.entries(skin.producers).find(([, producer]) => producer.item === ingredient)?.[0]
        if (!source) throw new Error(`no source for ${ingredient}`)
        return source
      }
      while (game.phase === 'playing') {
        const front = game.customers.find(customer => !customer.served && !customer.missed)
        if (!front) {
          runFor(game, .1)
          continue
        }
        const recipe = itemFor(skin, front.order.item).recipe
        if (!recipe) throw new Error(`order has no recipe: ${front.order.item}`)
        while (game.phase === 'playing' && !front.served && !front.missed
          && (game.counter.items[front.order.item] ?? 0) < front.order.quantity) {
          const recipeSize = Object.values(recipe.inputs).reduce((total, quantity) => total + quantity, 0)
          const remaining = front.order.quantity - (game.counter.items[front.order.item] ?? 0)
          const batch = Math.min(remaining, Math.max(1, Math.floor(trayCapacity(game) / recipeSize)))
          const targets = Object.fromEntries(Object.entries(recipe.inputs)
            .map(([ingredient, quantity]) => [ingredient, (game.player.trayItems[ingredient] ?? 0) + quantity * batch]))
          for (const [ingredient] of Object.entries(recipe.inputs)) {
            const source = producerPoint(skin, sourceFor(ingredient))
            while (game.phase === 'playing' && !front.missed
              && (game.player.trayItems[ingredient] ?? 0) < targets[ingredient]) {
              routeTo(source)
              runFor(game, .1)
              if (source.y > 1000) moveTo({ x: 480, y: source.y })
              moveTo({ x: 480, y: 880 })
            }
          }
          const before = game.player.trayItems[front.order.item] ?? 0
          routeTo(prepPoint(skin, recipe.station))
          while (game.phase === 'playing' && !front.missed
            && (game.player.trayItems[front.order.item] ?? 0) < before + batch) runFor(game, .1)
          routeTo(stationPoint(skin, 'counter'))
          runFor(game, batch * .7 + .4)
        }
        runFor(game, .8)
      }
      return game
    }
    const play = (dayIndex: number, upgrades: Record<string, number> = {}, openingDelay = 0) => {
      const save = defaultSave(skin)
      save.currentDay = dayIndex
      Object.assign(save.upgrades, upgrades)
      const game = createGame(skin, save)
      return playGame(game, openingDelay)
    }

    const campaign = play(0, {}, 3)
    const dayOne = [campaign.shift.revenue, campaign.shift.served, campaign.shift.missed, campaign.shift.stars]
    expect(goalMet(campaign), `Day 1 route: ${dayOne.join(',')}`).toBe(true)
    expect(campaign.shift.missed).toBeGreaterThan(0)
    expect(campaign.shift.stars).toBeGreaterThanOrEqual(1)
    expect(campaign.shift.stars).toBeLessThanOrEqual(2)
    expect(enterShop(campaign)).toBe(true)
    expect([purchaseUpgrade(campaign, 'shoes'), purchaseUpgrade(campaign, 'patience')]).toEqual([true, true])
    expect(campaign.save.coins).toBe(9)
    expect(nextDay(campaign)).toBe(true)
    playGame(campaign)
    const dayTwoUpgraded = [campaign.shift.revenue, campaign.shift.served, campaign.shift.missed, campaign.shift.stars]

    const dayTwoBase = play(1)
    expect(goalMet(campaign)).toBe(true)
    expect(campaign.shift.revenue).toBeGreaterThan(dayTwoBase.shift.revenue)
    expect(campaign.shift.served).toBeGreaterThanOrEqual(dayTwoBase.shift.served)
    expect(campaign.shift.missed).toBeLessThan(dayTwoBase.shift.missed)
    expect(enterShop(campaign)).toBe(true)
    expect([purchaseUpgrade(campaign, 'tray'), purchaseUpgrade(campaign, 'patience')]).toEqual([true, true])
    expect(campaign.save.coins).toBe(4)
    expect(nextDay(campaign)).toBe(true)
    playGame(campaign)
    const dayThreeUpgraded = [campaign.shift.revenue, campaign.shift.served, campaign.shift.missed, campaign.shift.stars]

    const dayThreeBase = play(2)
    const dayThreeReactive = play(2, { shoes: 2, patience: 2 })
    expect(dayThreeBase.shift.stars).toBeLessThan(3)
    expect(dayThreeReactive.shift.stars).toBe(2)
    expect(campaign.shift.revenue).toBeGreaterThan(dayThreeReactive.shift.revenue)
    expect(campaign.shift.served).toBeGreaterThan(dayThreeReactive.shift.served)
    expect(goalMet(campaign)).toBe(true)
    expect(campaign.shift.stars,
      `Day 3 base/upgraded: ${[dayThreeBase.shift.revenue, ...dayThreeUpgraded].join(',')}`).toBe(3)

    expect([
      dayOne,
      [dayTwoBase.shift.revenue, dayTwoBase.shift.served, dayTwoBase.shift.missed, dayTwoBase.shift.stars],
      dayTwoUpgraded,
      [dayThreeBase.shift.revenue, dayThreeBase.shift.served, dayThreeBase.shift.missed, dayThreeBase.shift.stars],
      [dayThreeReactive.shift.revenue, dayThreeReactive.shift.served, dayThreeReactive.shift.missed, dayThreeReactive.shift.stars],
      dayThreeUpgraded,
    ]).toEqual([
      [54, 4, 2, 1],
      [27, 2, 5, 0],
      [65, 4, 3, 1],
      [55, 2, 7, 0],
      [135, 5, 2, 2],
      [195, 7, 0, 3],
    ])

    const camped = Object.keys(skin.producers).map(source => {
      const game = createGame(skin)
      startShift(game)
      Object.assign(game.player, producerPoint(skin, source))
      runFor(game, firstDay.duration)
      return [game.shift.revenue, game.shift.served]
    })
    expect(camped).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]])
  })
})
