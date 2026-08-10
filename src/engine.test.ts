import { describe, expect, it } from 'vitest'
import {
  annexUnlocked,
  comboBonus,
  currentDay,
  customerPatience,
  createGame,
  defaultSave,
  enterShop,
  goalMet,
  helperInterval,
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
  WORLD,
  type GameState,
  type Point,
} from './engine'
import type { GameSkin } from './skin'
import { itemFor, prepPoint, producerPoint, stationPoint } from './skin'
import skinData from './skins/ice-cream.json'

const skin = skinData as GameSkin
const firstDay = skin.days[0]
const finishAt = (game: GameState, revenue: number) => {
  if (game.phase === 'ready') startShift(game)
  game.shift.revenue = revenue
  game.shift.remaining = .01
  step(game, .01)
}

describe('ice cream stand loop', () => {
  it('takes interaction geometry from the selected skin', () => {
    expect(prepPoint(skin, 'build-station')).toEqual({ x: 480, y: 730 })
    expect(stationPoint(skin, 'counter')).toEqual({ x: skin.stations.counter.interaction[0], y: skin.stations.counter.interaction[1] })
    expect(producerPoint(skin, 'soft-scoop')).toEqual({ x: 360, y: 1070 })
    expect(producerPoint(skin, 'chocolate-scoop')).toEqual({ x: 870, y: 1070 })
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

describe('kinetic service state (#16)', () => {
  const started = () => {
    const game = createGame(skin)
    startShift(game)
    return game
  }

  it('integrates bounded tray energy at +4 moving and -2.5 idle without idle drift', () => {
    const game = started()
    const start = { x: game.player.x, y: game.player.y }

    step(game, .05, { x: 1, y: 0 })
    expect(game.player.trayWobble).toBeCloseTo(.2)
    runFor(game, .2, { x: 1, y: 0 })
    expect(game.player.trayWobble).toBe(1)
    expect(game.player).toMatchObject({ x: start.x + walkSpeed(game) * .25, y: start.y })

    const stopped = { x: game.player.x, y: game.player.y }
    runFor(game, .2)
    expect(game.player.trayWobble).toBeCloseTo(.5)
    runFor(game, .2)
    expect(game.player.trayWobble).toBe(0)
    expect(game.player).toMatchObject(stopped)
  })

  it('timestamps source and prep pickups with cloned interaction origins', () => {
    const sourceGame = started()
    const source = producerPoint(skin, 'soft-scoop')
    sourceGame.sources['soft-scoop'].stock = 1
    Object.assign(sourceGame.player, { x: source.x + 40, y: source.y })
    step(sourceGame, .05)

    const sourcePickup = sourceGame.events.find(event => event.kind === 'pickup')
    expect(sourceGame.player.trayItems['soft-scoop']).toBe(1)
    expect(sourceGame.sources['soft-scoop'].stock).toBe(0)
    expect(sourceGame.player.trayWobble).toBe(.65)
    expect(sourcePickup).toMatchObject({
      kind: 'pickup', source: 'soft-scoop', item: 'soft-scoop', age: .05,
      createdAt: sourceGame.time, from: source,
      x: source.x + 40, y: source.y,
    })
    expect(sourcePickup?.from).not.toBe(sourceGame.player)

    const prepGame = started()
    const prep = prepPoint(skin, 'build-station')
    prepGame.prepStations['build-station'].outputs['vanilla-cone'] = 1
    Object.assign(prepGame.player, { x: prep.x + 40, y: prep.y })
    step(prepGame, .05)

    const prepPickup = prepGame.events.find(event => event.kind === 'pickup')
    expect(prepGame.prepStations['build-station'].outputs['vanilla-cone']).toBe(0)
    expect(prepGame.player.trayItems['vanilla-cone']).toBe(1)
    expect(prepGame.player.trayWobble).toBe(.65)
    expect(prepPickup).toMatchObject({
      kind: 'pickup', station: 'build-station', item: 'vanilla-cone', age: .05,
      createdAt: prepGame.time, from: prep,
      x: prep.x + 40, y: prep.y,
    })
    expect(prepPickup?.from).not.toBe(prepGame.player)
  })

  it('timestamps a drop from a cloned player origin and kicks empty-tray energy to .8', () => {
    const game = started()
    const counter = stationPoint(skin, 'counter')
    const from = { x: counter.x + 40, y: counter.y }
    game.player.trayItems['vanilla-cone'] = 1
    game.player.tray = 1
    Object.assign(game.player, from)
    step(game, .05)

    const drop = game.events.find(event => event.kind === 'drop')
    expect(game.player.trayItems['vanilla-cone']).toBe(0)
    expect(game.player.tray).toBe(0)
    expect(game.counter.items['vanilla-cone']).toBe(1)
    expect(game.player.trayWobble).toBe(.8)
    expect(drop).toMatchObject({
      kind: 'drop', item: 'vanilla-cone', age: .05,
      createdAt: game.time, from,
      x: counter.x, y: counter.y,
    })
    expect(drop?.from).not.toBe(game.player)
    game.player.x += 20
    expect(drop?.from).toEqual(from)
  })
})

describe('three-day shop campaign (#25)', () => {
  it('keeps days and all fifteen cumulative upgrade levels in skin data', () => {
    expect(skin.days).toHaveLength(3)
    expect(skin.days.map(day => day.cashGoal)).toEqual([45, 60, 70])
    expect(skin.days.map(day => day.customerPatience)).toEqual([50, 32, 60])
    expect(skin.days.map(day => day.spawnInterval)).toEqual([10, 8.5, 7.5])
    expect(skin.days.map(day => day.activeOrderWindow)).toEqual([1, 2, 3])
    expect(skin.scoreChase?.activeOrderWindow).toBe(3)
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
    expect(skin.upgrades.map(upgrade => upgrade.levels.length)).toEqual([3, 3, 3, 3, 3])
    expect(skin.upgrades.map(upgrade => upgrade.levels[0].price)).toEqual([25, 40, 80, 20, 180])
  })

  it('offers independent cards and purchases only inside the shop', () => {
    const game = createGame(skin)
    game.save.coins = 48
    const [shoes, tray, machine, patience, helper] = skin.upgrades
    expect([shoes, tray, machine, patience, helper].map(upgrade => upgradeOffer(game, upgrade).affordable))
      .toEqual([true, true, false, true, false])
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

  it('opens the same store before a shift and returns to the phase it came from (#49)', () => {
    const ready = createGame(skin)
    expect(enterShop(ready)).toBe(true)
    expect(ready).toMatchObject({ phase: 'shop', shopReturnPhase: 'ready' })
    expect(leaveShop(ready)).toBe(true)
    expect(ready.phase).toBe('ready')

    startShift(ready)
    expect(enterShop(ready)).toBe(false)

    const results = createGame(skin)
    finishAt(results, currentDay(results).cashGoal)
    expect(enterShop(results)).toBe(true)
    expect(results.shopReturnPhase).toBe('results')
    expect(leaveShop(results)).toBe(true)
    expect(results.phase).toBe('results')
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

  it('records each day, gates advancement through the shop, and unlocks score chase', () => {
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
    expect(game).toMatchObject({
      phase: 'ready',
      save: { currentDay: 2, scoreChaseLevel: 1 },
      rules: { kind: 'score-chase', level: 1 },
      nextOrder: 1,
    })
  })
})

describe('score chase rush ladder (#27)', () => {
  const rush = (level: number, upgrades: Record<string, number> = {}) => {
    const save = defaultSave(skin)
    save.currentDay = 2
    save.scoreChaseLevel = level
    Object.assign(save.upgrades, upgrades)
    return createGame(skin, save)
  }

  it('derives bounded rules and rotates a stable full-menu deck', () => {
    const baseDeck = structuredClone(skin.scoreChase!.orderDeck)
    expect(rush(1).rules).toMatchObject({
      kind: 'score-chase', level: 1, id: 'score-chase', label: 'RUSH',
      challenge: 'FULL MENU SCORE CHASE', duration: 120, cashGoal: 140,
      starThresholds: [140, 160, 180], customerPatience: 50, spawnInterval: 7.5,
      activeOrderWindow: 3,
      orderDeck: baseDeck,
    })
    expect(rush(2).rules).toMatchObject({
      level: 2, cashGoal: 150, starThresholds: [150, 170, 190],
      customerPatience: 48, spawnInterval: 7.25,
      orderDeck: [...baseDeck.slice(1), baseDeck[0]],
    })
    const second = rush(2)
    expect(second.customers[0].order).toMatchObject(baseDeck[1])
    expect(upcomingOrders(second, 2)).toMatchObject([baseDeck[2], baseDeck[3]])
    expect(rush(9).rules).toMatchObject({
      level: 9, cashGoal: 220, starThresholds: [220, 240, 260],
      customerPatience: 34, spawnInterval: 5.5, orderDeck: baseDeck,
    })
    expect(skin.scoreChase!.orderDeck).toEqual(baseDeck)

    const broken = structuredClone(skin)
    broken.scoreChase!.orderDeck = []
    expect(() => createGame(broken, { ...defaultSave(broken), currentDay: 2, scoreChaseLevel: 1 }))
      .toThrow('score chase order deck is empty')
  })

  it('defaults and clamps active order windows into the three-ticket rail', () => {
    const custom = structuredClone(skin)
    custom.days[0].activeOrderWindow = 99
    custom.days[1].activeOrderWindow = -4
    delete custom.days[2].activeOrderWindow
    custom.scoreChase!.activeOrderWindow = 2.9
    const campaignWindows = custom.days.map((_, currentDay) => {
      const save = defaultSave(custom)
      save.currentDay = currentDay
      return createGame(custom, save).rules.activeOrderWindow
    })
    const rushSave = defaultSave(custom)
    Object.assign(rushSave, { currentDay: 2, scoreChaseLevel: 1 })
    expect([...campaignWindows, createGame(custom, rushSave).rules.activeOrderWindow]).toEqual([3, 1, 1, 2])
  })

  it('keeps retry on the same rush and advances exactly once after success', () => {
    const game = rush(1)
    finishAt(game, game.rules.cashGoal - 1)
    enterShop(game)
    expect(nextDay(game)).toBe(false)
    expect(retryShift(game)).toBe(true)
    expect(game).toMatchObject({ phase: 'playing', save: { scoreChaseLevel: 1 }, rules: { level: 1 } })

    finishAt(game, game.rules.cashGoal)
    enterShop(game)
    expect(nextDay(game)).toBe(true)
    expect(game).toMatchObject({
      phase: 'ready', save: { currentDay: 2, scoreChaseLevel: 2 },
      rules: { kind: 'score-chase', level: 2, cashGoal: 150 },
    })
  })

  it('keeps the old final-day replay for skins without score chase', () => {
    const campaignOnly = structuredClone(skin)
    delete campaignOnly.scoreChase
    const save = defaultSave(campaignOnly)
    save.currentDay = 2
    const game = createGame(campaignOnly, save)
    finishAt(game, game.rules.cashGoal)
    enterShop(game)
    expect(nextDay(game)).toBe(true)
    expect(game).toMatchObject({
      save: { currentDay: 2, scoreChaseLevel: 0 },
      rules: { kind: 'campaign', level: 3 },
    })
  })

  it('records rush bests without changing any campaign record', () => {
    const game = rush(1)
    Object.assign(game.save, {
      bestRevenue: 195,
      bestStars: 3,
      dayStars: [1, 2, 3],
      dayBestRevenue: [54, 65, 195],
      scoreChaseBest: 150,
    })
    const campaignRecords = structuredClone({
      bestRevenue: game.save.bestRevenue,
      bestStars: game.save.bestStars,
      dayStars: game.save.dayStars,
      dayBestRevenue: game.save.dayBestRevenue,
    })
    finishAt(game, 220)
    expect(game.shift.stars).toBe(3)
    expect(game.save).toMatchObject({ ...campaignRecords, scoreChaseBest: 220 })

    retryShift(game)
    finishAt(game, 140)
    expect(game.save).toMatchObject({ ...campaignRecords, scoreChaseBest: 220 })
  })
})

describe('Chocolate Corner annex (#50)', () => {
  const started = (day: number, scoreChaseLevel = 0) => {
    const save = defaultSave(skin)
    Object.assign(save, { currentDay: day, scoreChaseLevel })
    const game = createGame(skin, save)
    startShift(game)
    return game
  }

  it('keeps the 960x1120 world and grounds the east doorway at one exact boundary', () => {
    expect(WORLD).toEqual({ width: 960, height: 1120 })
    expect(skin.room.annex).toEqual({
      label: 'CHOCOLATE CORNER', unlockStation: 'chocolate-scoop',
      boundaryX: 780, doorway: [770, 320, 20, 800],
    })
    expect(skin.producers['chocolate-scoop']).toMatchObject({
      interaction: [870, 1070], draw: [790, 915, 160, 190],
      stockDisplay: { origin: [825, 1058] },
    })
  })

  it('clamps Day 1 at x725 and opens the full x905 walk range on Day 2', () => {
    const locked = started(0)
    expect(annexUnlocked(locked)).toBe(false)
    Object.assign(locked.player, { x: 700, y: 800 })
    runFor(locked, 1, { x: 1, y: 0 })
    expect(locked.player).toMatchObject({ x: 725, y: 800 })

    const unlocked = started(1)
    expect(annexUnlocked(unlocked)).toBe(true)
    Object.assign(unlocked.player, { x: 700, y: 800 })
    runFor(unlocked, 2, { x: 1, y: 0 })
    expect(unlocked.player).toMatchObject({ x: 905, y: 800 })
  })

  it('derives both legacy Day 2 and Rush access from the existing station unlock', () => {
    const legacyDay2 = defaultSave(skin)
    legacyDay2.currentDay = 1
    legacyDay2.unlockedStations.push('retired-cart')
    const day2 = createGame(skin, legacyDay2)
    expect(day2.save).toMatchObject({ version: 1, currentDay: 1 })
    expect(day2.save.unlockedStations).toEqual([
      ...skin.progression.startingStations, 'retired-cart', 'chocolate-scoop',
    ])
    expect(annexUnlocked(day2)).toBe(true)

    const legacyRush = defaultSave(skin)
    Object.assign(legacyRush, { currentDay: 0, scoreChaseLevel: 1 })
    const rush = createGame(skin, legacyRush)
    expect(rush.save).toMatchObject({ version: 1, currentDay: 2, scoreChaseLevel: 1 })
    expect(rush.save.unlockedStations).toContain('chocolate-scoop')
    expect(annexUnlocked(rush)).toBe(true)
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

describe('Pip source-to-prep helper (#34)', () => {
  const started = (level = 1, day = 2) => {
    const save = defaultSave(skin)
    save.currentDay = day
    save.upgrades.helper = level
    const game = createGame(skin, save)
    for (const source of Object.values(game.sources)) source.timer = 999
    startShift(game)
    step(game, .05)
    return game
  }

  const setFront = (game: GameState, item: string, quantity = 1) => {
    const product = itemFor(skin, item)
    game.customers[0].order = {
      item, quantity, label: product.label, price: product.price * quantity,
      icon: product.icon, color: product.color,
    }
  }

  const stockRecipe = (game: GameState, item: string) => {
    const recipe = itemFor(skin, item).recipe!
    for (const [ingredient, quantity] of Object.entries(recipe.inputs)) {
      const source = Object.values(game.sources).find(candidate => candidate.item === ingredient)
      if (!source) throw new Error(`locked helper ingredient: ${ingredient}`)
      source.stock = quantity
    }
  }

  const walkTo = (game: GameState, target: Point) => {
    while (game.phase === 'playing') {
      const dx = target.x - game.player.x
      const dy = target.y - game.player.y
      const distance = Math.hypot(dx, dy)
      if (distance < 20) return
      step(game, .05, { x: dx / distance, y: dy / distance })
    }
  }

  it('keeps the helper data-driven at 0, 2, 3, and 4 batches per minute', () => {
    expect(skin.helper).toEqual({
      name: 'PIP', image: '/assets/helpers/pip-prep-pal.svg',
      draw: [678, 622, 64, 78], status: [640, 588, 128, 30],
      prepStation: 'build-station', upgradeId: 'helper',
    })
    expect(skin.upgrades.at(-1)).toEqual({
      id: 'helper', name: 'PIP HELPER', kind: 'helperRate', unit: 'STAGES / MIN',
      levels: [
        { price: 180, effect: 2 },
        { price: 360, effect: 3 },
        { price: 720, effect: 4 },
      ],
    })
    expect([0, 1, 2, 3].map(level => {
      const save = defaultSave(skin)
      save.upgrades.helper = level
      return helperInterval(createGame(skin, save))
    })).toEqual([null, 30, 20, 15])
  })

  it('stays inert when the selected skin has no helper', () => {
    const custom = structuredClone(skin)
    delete custom.helper
    const save = defaultSave(custom)
    save.currentDay = 2
    save.upgrades.helper = 3
    const game = createGame(custom, save)
    for (const source of Object.values(game.sources)) {
      source.stock = source.item === 'chocolate-scoop' || source.item === 'sundae-cup' ? 2 : 0
      source.timer = 999
    }
    expect(helperInterval(game)).toBeNull()
    expect(game.helper).toEqual({ targetCustomerId: null, remaining: 0 })

    startShift(game)
    runFor(game, 16)
    expect(game.prepStations['build-station'].job).toBeNull()
    expect(game.events.some(event => event.source === 'helper')).toBe(false)
  })

  it('ignores front recipes owned by another prep station', () => {
    const custom = structuredClone(skin)
    custom.prepStations['other-station'] = structuredClone(custom.prepStations['build-station'])
    custom.items['vanilla-cone'].recipe!.station = 'other-station'
    const save = defaultSave(custom)
    save.upgrades.helper = 3
    const game = createGame(custom, save)
    for (const source of Object.values(game.sources)) source.timer = 999
    game.sources['soft-scoop'].stock = 1
    game.sources['cone-shell'].stock = 1

    startShift(game)
    runFor(game, 16)
    expect(helperInterval(game)).toBe(15)
    expect(game.helper).toEqual({ targetCustomerId: null, remaining: 15 })
    expect(game.prepStations['build-station'].job).toBeNull()
    expect(game.prepStations['other-station'].job).toBeNull()
    expect([game.sources['soft-scoop'].stock, game.sources['cone-shell'].stock]).toEqual([1, 1])
  })

  it('pins a full countdown to the actual front customer id', () => {
    const game = started()
    const first = game.customers[0]
    const second = { ...first, id: 99, order: { ...first.order } }
    game.customers.push(second)
    expect(game.helper).toEqual({ targetCustomerId: first.id, remaining: 30 })

    runFor(game, 5)
    expect(game.helper.remaining).toBeCloseTo(25)
    first.missed = true
    step(game, .05)
    expect(game.helper).toEqual({ targetCustomerId: second.id, remaining: 30 })
  })

  it('atomically moves source stock into one paused assisted prep job', () => {
    const game = started(3)
    setFront(game, 'vanilla-cone')
    stockRecipe(game, 'vanilla-cone')
    game.helper.remaining = .05

    step(game, .05)

    expect(game.prepStations['build-station'].job).toEqual({
      item: 'vanilla-cone', remaining: prepSeconds(game, 'vanilla-cone'), assisted: true,
    })
    expect(game.sources['soft-scoop'].stock).toBe(0)
    expect(game.sources['cone-shell'].stock).toBe(0)
    expect(game.helper).toEqual({ targetCustomerId: game.customers[0].id, remaining: 15 })
    expect(game.events).toContainEqual(expect.objectContaining({
      kind: 'prep-start', item: 'vanilla-cone', station: 'build-station', source: 'helper',
    }))

    const remaining = game.prepStations['build-station'].job!.remaining
    runFor(game, .5)
    expect(game.prepStations['build-station'].job?.remaining).toBe(remaining)
    Object.assign(game.player, prepPoint(skin, 'build-station'))
    runFor(game, remaining + .7)
    expect(game.prepStations['build-station'].job).toBeNull()
    expect(game.player.trayItems['vanilla-cone']).toBe(1)
  })

  it('waits at ready without partial consumption, catch-up credit, or manual preemption', () => {
    const short = started(3)
    setFront(short, 'vanilla-cone')
    short.sources['soft-scoop'].stock = 1
    short.sources['cone-shell'].stock = 0
    short.helper.remaining = 0
    runFor(short, 1)
    expect(short.prepStations['build-station'].job).toBeNull()
    expect(short.sources['soft-scoop'].stock).toBe(1)
    expect(short.helper.remaining).toBe(0)
    expect(Object.values(short.sources).every(source => source.stock >= 0)).toBe(true)

    short.sources['cone-shell'].stock = 2
    step(short, .05)
    expect(short.prepStations['build-station'].job?.assisted).toBe(true)
    expect(short.sources['cone-shell'].stock).toBe(1)
    expect(short.helper.remaining).toBe(15)

    const partial = started(3)
    setFront(partial, 'vanilla-cone')
    stockRecipe(partial, 'vanilla-cone')
    partial.player.trayItems['soft-scoop'] = 1
    partial.player.tray = 1
    partial.helper.remaining = 0
    step(partial, .05)
    expect(partial.prepStations['build-station'].job?.assisted).toBe(true)
    expect(partial.player.trayItems['soft-scoop']).toBe(1)
    expect(Object.values(partial.sources).every(source => source.stock >= 0)).toBe(true)

    const manual = started(3)
    setFront(manual, 'vanilla-cone')
    stockRecipe(manual, 'vanilla-cone')
    Object.assign(manual.player.trayItems, { 'soft-scoop': 1, 'cone-shell': 1 })
    manual.player.tray = 2
    manual.helper.remaining = 0
    step(manual, .05)
    expect(manual.prepStations['build-station'].job).toBeNull()
    expect(manual.sources['soft-scoop'].stock).toBe(1)
    expect(manual.sources['cone-shell'].stock).toBe(1)

    Object.assign(manual.player, prepPoint(skin, 'build-station'))
    step(manual, .05)
    expect(manual.prepStations['build-station'].job).toEqual({ item: 'vanilla-cone', remaining: 1 })
    expect(manual.events.filter(event => event.kind === 'prep-start').at(-1)?.source).toBeUndefined()
  })

  it('starts a real base-speed manual job before the fastest helper', () => {
    const game = started(3)
    setFront(game, 'vanilla-cone')
    stockRecipe(game, 'vanilla-cone')

    walkTo(game, producerPoint(skin, 'soft-scoop'))
    walkTo(game, producerPoint(skin, 'cone-shell'))
    walkTo(game, prepPoint(skin, 'build-station'))

    expect(walkSpeed(game)).toBe(185)
    expect(game.time).toBeLessThan(helperInterval(game)!)
    expect(game.prepStations['build-station'].job).toMatchObject({ item: 'vanilla-cone' })
    expect(game.prepStations['build-station'].job?.assisted).toBeUndefined()
    expect(game.events.filter(event => event.kind === 'prep-start').at(-1)?.source).toBeUndefined()
  })

  it('keeps staged work through a walkout and resets helper state on retry', () => {
    const game = started(3)
    setFront(game, 'vanilla-cone')
    stockRecipe(game, 'vanilla-cone')
    const front = game.customers[0]
    game.customers.push({ ...front, id: 99, order: { ...front.order } })
    game.helper.remaining = .05
    step(game, .05)
    const staged = structuredClone(game.prepStations['build-station'].job)

    front.patience = .05
    step(game, .05)
    expect(front.missed).toBe(true)
    expect(game.prepStations['build-station'].job).toEqual(staged)
    expect(game.helper).toEqual({ targetCustomerId: 99, remaining: 15 })

    finishAt(game, game.rules.cashGoal)
    expect(retryShift(game)).toBe(true)
    expect(game.helper).toEqual({ targetCustomerId: null, remaining: 15 })
    expect(game.prepStations['build-station'].job).toBeNull()
  })

  it('counts staged quantity and respects busy, full, and locked prep paths', () => {
    const staged = started(3)
    setFront(staged, 'vanilla-cone', 2)
    stockRecipe(staged, 'vanilla-cone')
    staged.player.trayItems['vanilla-cone'] = 1
    staged.player.tray = 1
    staged.counter.items['vanilla-cone'] = 1
    staged.counter.stock = 1
    staged.helper.remaining = 0
    step(staged, .05)
    expect(staged.prepStations['build-station'].job).toBeNull()
    expect(staged.sources['soft-scoop'].stock).toBe(1)
    staged.customers[0].order.quantity = 3
    step(staged, .05)
    expect(staged.prepStations['build-station'].job?.assisted).toBe(true)

    const busy = started(3)
    setFront(busy, 'vanilla-cone')
    stockRecipe(busy, 'vanilla-cone')
    busy.prepStations['build-station'].job = { item: 'sundae', remaining: 1 }
    busy.helper.remaining = 0
    step(busy, .05)
    expect(busy.sources['soft-scoop'].stock).toBe(1)
    expect(busy.prepStations['build-station'].job?.item).toBe('sundae')

    const full = started(3)
    setFront(full, 'vanilla-cone')
    stockRecipe(full, 'vanilla-cone')
    full.prepStations['build-station'].outputs.sundae = 2
    full.helper.remaining = 0
    step(full, .05)
    expect(full.sources['soft-scoop'].stock).toBe(1)
    expect(full.prepStations['build-station'].job).toBeNull()

    const locked = started(3, 0)
    setFront(locked, 'chocolate-cone')
    locked.sources['cone-shell'].stock = 1
    locked.helper.remaining = 0
    step(locked, .05)
    expect(locked.sources['chocolate-scoop']).toBeUndefined()
    expect(locked.sources['cone-shell'].stock).toBe(1)
    expect(locked.prepStations['build-station'].job).toBeNull()
  })

  it('caps L3 cadence and makes waiting cost tips', () => {
    const saturated = started(3)
    setFront(saturated, 'vanilla-cone', 99)
    saturated.customers[0].patience = 999
    stockRecipe(saturated, 'vanilla-cone')
    saturated.shift.remaining = 120
    let dispatches = 0
    while (saturated.phase === 'playing') {
      step(saturated, .05)
      if (!saturated.events.some(event => event.source === 'helper' && event.createdAt === saturated.time)) continue
      dispatches++
      saturated.prepStations['build-station'].job = null
      stockRecipe(saturated, 'vanilla-cone')
    }
    expect(dispatches).toBe(8)

    const manual = started(0, 0)
    const item = manual.customers[0].order.item
    manual.counter.items[item] = manual.customers[0].order.quantity
    manual.counter.stock = manual.customers[0].order.quantity
    runFor(manual, .75)
    const manualTip = manual.events.find(event => event.kind === 'pay')?.tip

    const waiting = started(1, 0)
    stockRecipe(waiting, waiting.customers[0].order.item)
    runFor(waiting, 30.1)
    expect(waiting.prepStations['build-station'].job?.assisted).toBe(true)
    Object.assign(waiting.player, prepPoint(skin, 'build-station'))
    runFor(waiting, prepSeconds(waiting, item) + .7)
    Object.assign(waiting.player, stationPoint(skin, 'counter'))
    runFor(waiting, 1.5)
    const helperTip = waiting.events.find(event => event.kind === 'pay')?.tip
    expect([manualTip, helperTip]).toEqual([3, 2])
  })
})

describe('open counter (#32)', () => {
  const started = (day: number) => {
    const save = defaultSave(skin)
    save.currentDay = day
    const game = createGame(skin, save)
    startShift(game)
    return game
  }

  const addOrder = (game: GameState, item: string, quantity = 1) => {
    const product = itemFor(skin, item)
    const id = Math.max(...game.customers.map(customer => customer.id)) + 1
    const added = {
      ...game.customers[0],
      id,
      look: id % skin.sprites.customers.length,
      served: false,
      missed: false,
      patience: customerPatience(game),
      order: { item, quantity, label: product.label, price: product.price * quantity, icon: product.icon, color: product.color },
      x: 900,
      y: 345,
      exit: 0,
    }
    game.customers.push(added)
    return added
  }

  it('keeps later stock inert on Day 1 and serves the oldest fulfillable open order on Day 2', () => {
    const locked = started(0)
    const lockedSecond = addOrder(locked, 'sundae')
    locked.counter.items.sundae = 1
    locked.counter.stock = 1
    runFor(locked, .75)
    expect(lockedSecond.served).toBe(false)
    expect(locked.counter).toMatchObject({ serveTimer: 0, servingCustomerId: null })

    const open = started(1)
    const front = open.customers[0]
    const second = addOrder(open, 'vanilla-cone')
    const hidden = addOrder(open, 'sundae')
    Object.assign(open.counter.items, { 'vanilla-cone': 1, sundae: 1 })
    open.counter.stock = 2
    runFor(open, .75)
    expect(front.served).toBe(false)
    expect(second.served).toBe(true)
    expect(hidden.served).toBe(false)
    expect(open.events).toContainEqual(expect.objectContaining({ kind: 'pay', item: 'vanilla-cone' }))

    const partial = started(2)
    const double = partial.customers[0]
    const single = addOrder(partial, double.order.item)
    partial.counter.items[double.order.item] = 1
    partial.counter.stock = 1
    runFor(partial, .75)
    expect(double.served).toBe(false)
    expect(single.served).toBe(true)

    const boundary = started(2)
    addOrder(boundary, 'vanilla-cone')
    const third = addOrder(boundary, 'chocolate-cone')
    const fourth = addOrder(boundary, 'sundae')
    Object.assign(boundary.counter.items, { 'chocolate-cone': 1, sundae: 1 })
    boundary.counter.stock = 2
    runFor(boundary, .75)
    expect(third.served).toBe(true)
    expect(fourth.served).toBe(false)
  })

  it('prefers open-order tray items and warns only for products outside the window', () => {
    const game = started(1)
    addOrder(game, 'vanilla-cone')
    addOrder(game, 'sundae')
    Object.assign(game.player.trayItems, { 'vanilla-cone': 1, sundae: 1 })
    game.player.tray = 2
    Object.assign(game.player, stationPoint(skin, 'counter'))

    step(game, .05)
    expect(game.counter.items['vanilla-cone']).toBe(1)
    expect(game.events.some(event => event.reason === 'wrong-item')).toBe(false)

    game.pickupCooldown = 0
    step(game, .05)
    expect(game.counter.items.sundae).toBe(1)
    expect(game.events).toContainEqual(expect.objectContaining({
      kind: 'reject', item: 'sundae', expectedItem: game.customers[0].order.item, reason: 'wrong-item',
    }))
  })

  it('pins serve progress to one customer and resets it when priority changes', () => {
    const game = started(2)
    const front = game.customers[0]
    const second = addOrder(game, 'vanilla-cone')
    game.counter.items['vanilla-cone'] = 1
    game.counter.stock = 1

    runFor(game, .4)
    expect(game.counter.servingCustomerId).toBe(second.id)
    expect(game.counter.serveTimer).toBeCloseTo(.4)

    game.counter.items[front.order.item] = front.order.quantity
    game.counter.stock = inventoryTotal(game.counter.items)
    runFor(game, .35)
    expect(game.counter.servingCustomerId).toBe(front.id)
    expect(game.counter.serveTimer).toBeCloseTo(.35)
    expect(front.served).toBe(false)

    runFor(game, .36)
    expect(front.served).toBe(true)
    expect(second.served).toBe(false)
    expect(game.counter.servingCustomerId).toBe(second.id)
    expect(game.counter.serveTimer).toBeCloseTo(.01)
    runFor(game, .69)
    expect(second.served).toBe(true)
  })

  it('resets an in-flight later serve when another customer walks out', () => {
    const game = started(1)
    const front = game.customers[0]
    const second = addOrder(game, 'vanilla-cone')
    game.counter.items['vanilla-cone'] = 1
    game.counter.stock = 1
    runFor(game, .4)

    front.patience = .05
    step(game, .05)
    expect(front.missed).toBe(true)
    expect(game.counter).toMatchObject({ servingCustomerId: second.id, serveTimer: .05 })
    expect(second.served).toBe(false)
  })

  it('pins the skip payoff while preserving front-order miss and combo risk', () => {
    const skip = (activeOrderWindow: number) => {
      const game = started(1)
      game.rules.activeOrderWindow = activeOrderWindow
      game.customers[0].patience = 10
      const second = addOrder(game, 'vanilla-cone')
      second.patience = .8
      game.counter.items['vanilla-cone'] = 1
      game.counter.stock = 1
      runFor(game, .85)
      return [game.shift.served, game.shift.missed, game.events.find(event => event.kind === 'pay')?.amount ?? 0]
    }
    expect([skip(1), skip(2)]).toEqual([[0, 1, 0], [1, 0, 11]])

    const careless = started(1)
    careless.shift.streak = 2
    careless.shift.bestStreak = 2
    careless.customers[0].patience = .2
    addOrder(careless, 'vanilla-cone')
    careless.counter.items['vanilla-cone'] = 1
    careless.counter.stock = 1
    runFor(careless, .95)
    expect(careless.shift).toMatchObject({ served: 1, missed: 1, streak: 1, bestStreak: 2 })
    expect(careless.events).toContainEqual(expect.objectContaining({ kind: 'combo-break', streak: 2 }))
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
    game.counter.servingCustomerId = front.id
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

  it('pins campaign balance and same-upgrade reactive versus preview-planned rush routes', () => {
    const idle = started()
    runFor(idle, firstDay.duration)
    expect(idle.shift.revenue).toBe(0)
    expect(goalMet(idle)).toBe(false)

    const playGame = (game: GameState, openingDelay = 0, previewPlanned = false, triageLater = false) => {
      startShift(game)
      runFor(game, openingDelay)
      const deliberateRoute = previewPlanned || game.rules.kind === 'campaign'
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
          if (deliberateRoute && game.player.y > 1000 && Math.abs(game.player.x - target.x) <= 120) {
            moveTo(target)
            return
          }
          if (target.x >= (skin.room.annex?.boundaryX ?? WORLD.width)) {
            if (deliberateRoute) {
              moveTo(target)
            } else {
              moveTo({ x: game.player.x, y: 800 })
              moveTo({ x: target.x, y: 800 })
              moveTo(target)
            }
            return
          }
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
        const waiting = game.customers.filter(customer => !customer.served && !customer.missed)
        const front = waiting[0]
        if (!front) {
          runFor(game, .1)
          continue
        }

        const assisted = triageLater && Object.values(game.prepStations)
          .find(prep => prep.job?.assisted)?.job
        if (assisted) {
          const before = game.player.trayItems[assisted.item] ?? 0
          routeTo(prepPoint(skin, itemFor(skin, assisted.item).recipe!.station))
          while (game.phase === 'playing' && (game.player.trayItems[assisted.item] ?? 0) <= before) runFor(game, .1)
          routeTo(stationPoint(skin, 'counter'))
          runFor(game, 1.2)
          continue
        }

        const work = triageLater ? waiting.slice(1, game.rules.activeOrderWindow)[0] : front
        if (!work) {
          runFor(game, .1)
          continue
        }
        if (!previewPlanned || triageLater || game.skin.room.annex) {
          const recipe = itemFor(skin, work.order.item).recipe
          if (!recipe) throw new Error(`order has no recipe: ${work.order.item}`)
          while (game.phase === 'playing' && !work.served && !work.missed
            && (game.counter.items[work.order.item] ?? 0) < work.order.quantity) {
            const recipeSize = Object.values(recipe.inputs).reduce((total, quantity) => total + quantity, 0)
            const remaining = work.order.quantity - (game.counter.items[work.order.item] ?? 0)
            const batch = Math.min(remaining, Math.max(1, Math.floor(trayCapacity(game) / recipeSize)))
            const targets = Object.fromEntries(Object.entries(recipe.inputs)
              .map(([ingredient, quantity]) => [ingredient, (game.player.trayItems[ingredient] ?? 0) + quantity * batch]))
            for (const [ingredient] of Object.entries(recipe.inputs)) {
              const source = producerPoint(skin, sourceFor(ingredient))
              while (game.phase === 'playing' && !work.missed
                && (game.player.trayItems[ingredient] ?? 0) < targets[ingredient]) {
                routeTo(source)
                runFor(game, .1)
                if (deliberateRoute && source.y > 1000
                  && (game.player.trayItems[ingredient] ?? 0) < targets[ingredient]) {
                  const direction = source.x >= (skin.room.annex?.boundaryX ?? WORLD.width) ? -1 : 1
                  moveTo({ x: source.x + direction * 90, y: source.y })
                  continue
                }
                if (source.y > 1000) {
                  if (source.x < (skin.room.annex?.boundaryX ?? WORLD.width)) {
                    moveTo({ x: 480, y: source.y })
                  }
                }
                moveTo({ x: 480, y: 880 })
              }
            }
            const before = game.player.trayItems[work.order.item] ?? 0
            routeTo(prepPoint(skin, recipe.station))
            while (game.phase === 'playing' && !work.missed
              && (game.player.trayItems[work.order.item] ?? 0) < before + batch) runFor(game, .1)
            routeTo(stationPoint(skin, 'counter'))
            runFor(game, batch * .7 + .4)
          }
          runFor(game, .8)
          continue
        }

        const visible = [front.order, ...upcomingOrders(game, 2)]
        const products: string[] = []
        let slots = trayCapacity(game) - inventoryTotal(game.player.trayItems)
        for (const order of visible) {
          const recipe = itemFor(skin, order.item).recipe
          if (!recipe) throw new Error(`order has no recipe: ${order.item}`)
          const recipeSize = Object.values(recipe.inputs).reduce((total, quantity) => total + quantity, 0)
          let need = order.quantity - (game.counter.items[order.item] ?? 0)
            - products.filter(item => item === order.item).length
          while (need-- > 0 && slots >= recipeSize) {
            products.push(order.item)
            slots -= recipeSize
          }
        }
        if (products.length === 0) {
          runFor(game, .1)
          continue
        }

        const ingredients: Record<string, number> = {}
        for (const product of products) {
          for (const [ingredient, quantity] of Object.entries(itemFor(skin, product).recipe!.inputs)) {
            ingredients[ingredient] = (ingredients[ingredient] ?? 0) + quantity
          }
        }
        for (const [ingredient, quantity] of Object.entries(ingredients)) {
          const target = (game.player.trayItems[ingredient] ?? 0) + quantity
          const source = producerPoint(skin, sourceFor(ingredient))
          while (game.phase === 'playing' && !front.missed
            && (game.player.trayItems[ingredient] ?? 0) < target) {
            routeTo(source)
            runFor(game, .1)
            if (deliberateRoute && source.y > 1000 && (game.player.trayItems[ingredient] ?? 0) < target) {
              const direction = source.x >= (skin.room.annex?.boundaryX ?? WORLD.width) ? -1 : 1
              moveTo({ x: source.x + direction * 90, y: source.y })
              continue
            }
            if (source.y > 1000) {
              if (source.x < (skin.room.annex?.boundaryX ?? WORLD.width)) {
                moveTo({ x: 480, y: source.y })
              }
            }
            moveTo({ x: 480, y: 880 })
          }
        }
        if (front.missed) {
          const salvage = products.find(product => Object.entries(itemFor(skin, product).recipe!.inputs)
            .every(([item, quantity]) => (game.player.trayItems[item] ?? 0) >= quantity))
          if (!salvage) {
            runFor(game, .8)
            continue
          }
          products.splice(0, products.length, salvage)
        }

        const targets = Object.fromEntries([...new Set(products)].map(product => [
          product,
          (game.player.trayItems[product] ?? 0) + products.filter(item => item === product).length,
        ]))
        routeTo(prepPoint(skin, 'build-station'))
        while (game.phase === 'playing' && Object.entries(targets)
          .some(([product, quantity]) => (game.player.trayItems[product] ?? 0) < quantity)) runFor(game, .1)
        routeTo(stationPoint(skin, 'counter'))
        runFor(game, products.length * .7 + .4)
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
    expect(campaign.save.coins).toBe(5)
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
      [66, 4, 3, 1],
      [87, 3, 6, 1],
      [158, 6, 2, 2],
      [227, 8, 0, 3],
    ])
    expect(campaign.save.coins).toBe(232)
    expect(enterShop(campaign)).toBe(true)
    expect(purchaseUpgrade(campaign, 'helper')).toBe(true)
    expect(campaign.save).toMatchObject({ coins: 52, upgrades: { helper: 1 } })

    const playRush = (
      level: number,
      previewPlanned: boolean,
      upgrades: Record<string, number> = { shoes: 3, tray: 3, machine: 3, patience: 3 },
      triageLater = false,
    ) => {
      const save = defaultSave(skin)
      save.currentDay = 2
      save.scoreChaseLevel = level
      Object.assign(save.upgrades, upgrades)
      return playGame(createGame(skin, save), 0, previewPlanned, triageLater)
    }
    const rushTuples = [1, 5, 9].flatMap(level => [false, true].map(previewPlanned => {
      const game = playRush(level, previewPlanned)
      return [game.shift.revenue, game.shift.served, game.shift.missed, game.shift.stars]
    }))
    expect(rushTuples).toEqual([
      [217, 9, 0, 3], [253, 10, 0, 3],
      [194, 8, 0, 1], [248, 10, 0, 3],
      [189, 9, 1, 0], [245, 10, 0, 2],
    ])
    for (let index = 0; index < rushTuples.length; index += 2) {
      expect(rushTuples[index + 1][0]).toBeGreaterThan(rushTuples[index][0])
    }
    const entryBuild = { shoes: 1, tray: 1, machine: 0, patience: 2 }
    expect([false, true].map(previewPlanned => {
      const game = playRush(1, previewPlanned, entryBuild)
      return [game.shift.revenue, game.shift.served, game.shift.missed, game.shift.stars]
    })).toEqual([[124, 6, 3, 0], [144, 6, 1, 1]])

    const helperEntryRoutes = [0, 1].map(helper => {
      const game = playRush(1, true, { ...entryBuild, helper }, true)
      return [game.shift.revenue, game.shift.served, game.shift.missed, game.shift.stars]
    })
    expect(helperEntryRoutes).toEqual([[175, 7, 2, 2], [184, 8, 1, 3]])

    const lastPlannedPass = playRush(11, true)
    const firstPlannedFail = playRush(12, true)
    expect([lastPlannedPass, firstPlannedFail].map(game => [
      game.rules.cashGoal, game.shift.revenue, game.shift.served, game.shift.missed, game.shift.stars,
    ])).toEqual([[240, 248, 10, 0, 1], [250, 230, 9, 0, 0]])
    expect(lastPlannedPass.rules).toMatchObject({ customerPatience: 34, spawnInterval: 5.5 })
    expect(firstPlannedFail.rules).toMatchObject({ customerPatience: 34, spawnInterval: 5.5 })
    expect(goalMet(lastPlannedPass)).toBe(true)
    expect(goalMet(firstPlannedFail)).toBe(false)

    const helperMax = { shoes: 3, tray: 3, machine: 3, patience: 3, helper: 3 }
    const helperLastPass = playRush(14, true, helperMax, true)
    const helperFirstFail = playRush(15, true, helperMax, true)
    expect([helperLastPass, helperFirstFail].map(game => [
      game.rules.cashGoal, game.shift.revenue, game.shift.served, game.shift.missed, game.shift.stars,
    ])).toEqual([[270, 291, 13, 1, 2], [280, 232, 10, 1, 0]])
    expect(helperLastPass.rules).toMatchObject({ customerPatience: 34, spawnInterval: 5.5 })
    expect(helperFirstFail.rules).toMatchObject({ customerPatience: 34, spawnInterval: 5.5 })
    expect(goalMet(helperLastPass)).toBe(true)
    expect(goalMet(helperFirstFail)).toBe(false)

    const camped = Object.keys(skin.producers).map(source => {
      const game = createGame(skin)
      startShift(game)
      Object.assign(game.player, producerPoint(skin, source))
      runFor(game, firstDay.duration)
      return [game.shift.revenue, game.shift.served]
    })
    expect(camped).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]])

    const helperCampSave = defaultSave(skin)
    Object.assign(helperCampSave, { currentDay: 2, scoreChaseLevel: 1 })
    helperCampSave.upgrades.helper = 3
    const helperCamped = createGame(skin, helperCampSave)
    startShift(helperCamped)
    Object.assign(helperCamped.player, prepPoint(skin, 'build-station'))
    runFor(helperCamped, helperCamped.rules.duration)
    expect([helperCamped.shift.revenue, helperCamped.shift.served]).toEqual([0, 0])
  })
})
