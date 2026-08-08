import type { CustomerOrder, GameSkin, SkinDay, SkinUpgrade, UpgradeKind } from './skin'
import { itemFor, prepPoint, producerPoint, stationPoint } from './skin'

export type Point = { x: number; y: number }
export type Input = Point
export type EventKind = 'pickup' | 'drop' | 'pour' | 'prep-start' | 'prep-ready' | 'pay' | 'reject' | 'combo-break'
export type RejectReason = 'wrong-item' | 'needs-prep' | 'returned-raw'
export type Inventory = Record<string, number>

export type SaveV1 = {
  version: 1
  coins: number
  unlockedStations: string[]
  upgrades: Record<string, number>
  skin: string
  text: boolean
  bestRevenue: number
  bestStars: number
  currentDay: number
  lifetimeCash: number
  dayStars: [number, number, number]
  dayBestRevenue: [number, number, number]
  scoreChaseLevel: number
  scoreChaseBest: number
}

export type ActiveShiftRules = Pick<SkinDay,
  'id' | 'label' | 'challenge' | 'unlockBanner' | 'duration' | 'cashGoal' | 'starThresholds'
  | 'customerPatience' | 'spawnInterval' | 'orderDeck'> & {
    kind: 'campaign' | 'score-chase'
    level: number
    activeOrderWindow: number
  }

export type ShiftPhase = 'ready' | 'playing' | 'results' | 'shop'
export type ShiftState = {
  remaining: number
  revenue: number
  served: number
  missed: number
  streak: number
  bestStreak: number
  stars: number
}

export type Customer = {
  id: number
  look: number
  served: boolean
  missed: boolean
  patience: number
  order: CustomerOrder
  x: number
  y: number
  exit: number
}

export type FlyingCoin = Point & {
  id: number
  vx: number
  vy: number
  age: number
  collected: boolean
  value: number
}

export type GameEvent = Point & {
  kind: EventKind
  age: number
  createdAt: number
  from?: Point
  amount?: number
  tip?: number
  combo?: number
  streak?: number
  item?: string
  expectedItem?: string
  source?: string
  station?: string
  reason?: RejectReason
}

export type ProducerState = { item: string; stock: number; timer: number }
export type PrepJob = { item: string; remaining: number; assisted?: boolean }
export type PrepState = { job: PrepJob | null; outputs: Inventory }
export type HelperState = { targetCustomerId: number | null; remaining: number }

export type GameState = {
  skin: GameSkin
  rules: ActiveShiftRules
  phase: ShiftPhase
  shift: ShiftState
  time: number
  player: Point & { facing: number; moving: boolean; tray: number; trayItems: Inventory; trayWobble: number }
  sources: Record<string, ProducerState>
  /** Compatibility alias for the original renderer; sources is authoritative. */
  machine: ProducerState
  prepStations: Record<string, PrepState>
  helper: HelperState
  counter: { stock: number; items: Inventory; serveTimer: number; servingCustomerId: number | null }
  customers: Customer[]
  flyingCoins: FlyingCoin[]
  events: GameEvent[]
  spawnTimer: number
  nextOrder: number
  pickupCooldown: number
  sourceContact: string | null
  save: SaveV1
}

export type UpgradeOffer = {
  level: number
  price: number | null
  before: number
  after: number
  affordable: boolean
  capped: boolean
}

export const WORLD = { width: 960, height: 1120 }
const INTERACTION_COOLDOWN = .65
export const defaultSave = (skin: GameSkin): SaveV1 => ({
  version: 1,
  coins: 0,
  unlockedStations: [...new Set(skin.progression.startingStations)],
  upgrades: Object.fromEntries(skin.upgrades.map(upgrade => [upgrade.id, 0])),
  skin: skin.id,
  text: true,
  bestRevenue: 0,
  bestStars: 0,
  currentDay: 0,
  lifetimeCash: 0,
  dayStars: [0, 0, 0],
  dayBestRevenue: [0, 0, 0],
  scoreChaseLevel: 0,
  scoreChaseBest: 0,
})

function backfillDayUnlocks(skin: GameSkin, save: SaveV1): void {
  const dayIndex = clamp(Math.floor(save.currentDay), 0, skin.days.length - 1)
  for (const day of skin.days.slice(0, dayIndex + 1)) {
    for (const station of day.unlockStations ?? []) {
      if (!save.unlockedStations.includes(station)) save.unlockedStations.push(station)
    }
  }
}

export function upgradeLevel(save: SaveV1, id: string): number {
  return clamp(Math.floor(Number.isFinite(save.upgrades[id]) ? save.upgrades[id] : 0), 0, 3)
}

function savedUpgradeEffect(skin: GameSkin, save: SaveV1, kind: UpgradeKind): number {
  return skin.upgrades.reduce((total, upgrade) => {
    if (upgrade.kind !== kind) return total
    return total + (upgrade.levels[upgradeLevel(save, upgrade.id) - 1]?.effect ?? 0)
  }, 0)
}

export function upgradeEffect(state: GameState, kind: UpgradeKind): number {
  return savedUpgradeEffect(state.skin, state.save, kind)
}

export function upgradeOffer(state: GameState, upgrade: SkinUpgrade): UpgradeOffer {
  const level = upgradeLevel(state.save, upgrade.id)
  const next = upgrade.levels[level]
  const before = upgrade.levels[level - 1]?.effect ?? 0
  return {
    level,
    price: next?.price ?? null,
    before,
    after: next?.effect ?? before,
    affordable: Boolean(next && state.save.coins >= next.price),
    capped: !next,
  }
}

export function currentDay(state: GameState): SkinDay {
  const day = state.skin.days[clamp(Math.floor(state.save.currentDay), 0, state.skin.days.length - 1)]
  if (!day) throw new Error('campaign has no days')
  return day
}

export const walkSpeed = (state: GameState): number => 185 + upgradeEffect(state, 'walkSpeed')
export const trayCapacity = (state: GameState): number => 2 + upgradeEffect(state, 'trayCapacity')
export const producerInterval = (state: GameState, source = state.skin.progression.startingStation): number =>
  state.skin.producers[source].interval
export const machineInterval = producerInterval
export const customerPatience = (state: GameState): number => state.rules.customerPatience + upgradeEffect(state, 'customerPatience')
export function helperInterval(state: GameState): number | null {
  const helper = state.skin.helper
  if (!helper) return null
  const upgrade = state.skin.upgrades.find(candidate => candidate.id === helper.upgradeId)
  const rate = upgrade?.levels[upgradeLevel(state.save, helper.upgradeId) - 1]?.effect ?? 0
  return rate > 0 ? 60 / rate : null
}

export function prepSeconds(state: GameState, item: string): number {
  const recipe = itemFor(state.skin, item).recipe
  if (!recipe) throw new Error(`item has no recipe: ${item}`)
  return Math.max(.25, recipe.seconds - upgradeEffect(state, 'churnTime'))
}

export function createGame(skin: GameSkin, save: SaveV1 = defaultSave(skin)): GameState {
  const saved = structuredClone(save)
  if (saved.scoreChaseLevel > 0 && skin.scoreChase) saved.currentDay = skin.days.length - 1
  // SaveV1 already persists both currentDay and station history. Rebuild any
  // day-earned station here so older saves gain new content without SaveV2.
  backfillDayUnlocks(skin, saved)
  const sources = Object.fromEntries(Object.entries(skin.producers)
    .filter(([source]) => saved.unlockedStations.includes(source))
    .map(([source, producer]) => {
      return [source, {
        item: producer.item,
        stock: 0,
        timer: producer.interval,
      }]
    }))
  const prepStations = Object.fromEntries(Object.keys(skin.prepStations).map(station => [station, {
    job: null,
    outputs: emptyInventory(skin),
  }]))
  const machine = sources[skin.progression.startingStation]
  if (!machine) throw new Error(`unknown starting producer: ${skin.progression.startingStation}`)
  const rules = activeShiftRules(skin, saved)
  const state: GameState = {
    skin,
    rules,
    phase: 'ready',
    shift: freshShift(rules),
    time: 0,
    player: { x: 480, y: 880, facing: 1, moving: false, tray: 0, trayItems: emptyInventory(skin), trayWobble: 0 },
    sources,
    machine,
    prepStations,
    helper: { targetCustomerId: null, remaining: 0 },
    counter: { stock: 0, items: emptyInventory(skin), serveTimer: 0, servingCustomerId: null },
    customers: [customer(skin, saved, rules, 1, 0)],
    flyingCoins: [],
    events: [],
    spawnTimer: 2,
    nextOrder: 1,
    pickupCooldown: 0,
    sourceContact: null,
    save: saved,
  }
  state.helper.remaining = helperInterval(state) ?? 0
  return state
}

function freshShift(rules: ActiveShiftRules): ShiftState {
  return {
    remaining: rules.duration,
    revenue: 0,
    served: 0,
    missed: 0,
    streak: 0,
    bestStreak: 0,
    stars: 0,
  }
}

function orderAt(skin: GameSkin, rules: ActiveShiftRules, index: number): CustomerOrder {
  const request = rules.orderDeck[index % rules.orderDeck.length]
  if (!request) throw new Error('order deck is empty')
  const item = itemFor(skin, request.item)
  return {
    ...request,
    label: item.label,
    price: item.price * request.quantity,
    icon: item.icon,
    color: item.color,
  }
}

function customer(skin: GameSkin, save: SaveV1, rules: ActiveShiftRules, id: number, look: number): Customer {
  return {
    id,
    look: look % 4,
    served: false,
    missed: false,
    patience: rules.customerPatience + savedUpgradeEffect(skin, save, 'customerPatience'),
    order: orderAt(skin, rules, look),
    x: 700,
    y: 550,
    exit: 0,
  }
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const near = (a: Point, b: Point, radius = 68) => distance(a, b) < radius

export function step(state: GameState, seconds: number, input: Input = { x: 0, y: 0 }): void {
  if (state.phase !== 'playing') return
  const dt = Math.min(Math.max(seconds, 0), 0.05, state.shift.remaining)
  if (dt <= 0) {
    finishShift(state)
    return
  }
  state.time += dt
  state.pickupCooldown = Math.max(0, state.pickupCooldown - dt)

  const length = Math.hypot(input.x, input.y)
  const speed = walkSpeed(state)
  const nx = length > 1 ? input.x / length : input.x
  const ny = length > 1 ? input.y / length : input.y
  state.player.moving = length > 0.05
  if (state.player.moving) {
    state.player.x = clamp(state.player.x + nx * speed * dt, 55, WORLD.width - 55)
    state.player.y = clamp(state.player.y + ny * speed * .72 * dt, 330, WORLD.height - 45)
    if (Math.abs(nx) > .1) state.player.facing = Math.sign(nx)
  }
  state.player.trayWobble = clamp(
    state.player.trayWobble + dt * (state.player.moving ? 4 : -2.5),
    0,
    1,
  )

  for (const [sourceId, source] of Object.entries(state.sources)) {
    source.timer -= dt
    const producer = state.skin.producers[sourceId]
    if (source.timer <= 0 && source.stock < producer.capacity) {
      source.stock++
      source.timer = producerInterval(state, sourceId)
      emit(state, 'pour', producerPoint(state.skin, sourceId), { item: source.item, source: sourceId })
    }
  }

  const capacity = trayCapacity(state)
  const counter = stationPoint(state.skin, 'counter')
  if (state.sourceContact && !near(state.player, producerPoint(state.skin, state.sourceContact))) {
    state.sourceContact = null
  }
  for (const [sourceId, source] of Object.entries(state.sources)) {
    const point = producerPoint(state.skin, sourceId)
    if (state.pickupCooldown > 0 || state.sourceContact === sourceId
      || !near(state.player, point)
      || source.stock <= 0 || inventoryTotal(state.player.trayItems) >= capacity) continue
    source.stock--
    addStock(state.player.trayItems, source.item, 1)
    state.player.tray = inventoryTotal(state.player.trayItems)
    state.pickupCooldown = INTERACTION_COOLDOWN
    state.sourceContact = sourceId
    state.player.trayWobble = Math.max(state.player.trayWobble, .65)
    emit(state, 'pickup', state.player, {
      item: source.item,
      source: sourceId,
      from: { x: point.x, y: point.y },
    })
    break
  }

  updatePrepStations(state, dt, capacity)

  if (state.pickupCooldown === 0 && near(state.player, counter) && inventoryTotal(state.player.trayItems) > 0) {
    const waiting = state.customers.filter(item => !item.served && !item.missed)
    const active = waiting.slice(0, state.rules.activeOrderWindow)
    const front = waiting[0]
    const requested = active.find(customer => (state.player.trayItems[customer.order.item] ?? 0) > 0)
    const item = requested
      ? requested.order.item
      : firstStock(state.skin, state.player.trayItems)
    state.pickupCooldown = INTERACTION_COOLDOWN
    if (!itemFor(state.skin, item).recipe) {
      const returned = inventoryTotal(state.player.trayItems) >= capacity && !hasAvailablePrepCapacity(state)
        ? rawToReturn(state, front?.order.item)
        : undefined
      const owner = returned && Object.entries(state.sources)
        .find(([, source]) => source.item === returned)?.[0]
      if (returned && owner) {
        addStock(state.player.trayItems, returned, -1)
        state.player.tray = inventoryTotal(state.player.trayItems)
        state.sources[owner].stock++
        emit(state, 'reject', counter, { item: returned, expectedItem: front?.order.item, source: owner, reason: 'returned-raw' })
      } else {
        emit(state, 'reject', counter, { item, expectedItem: front?.order.item, reason: 'needs-prep' })
      }
    } else {
      const from = { x: state.player.x, y: state.player.y }
      addStock(state.player.trayItems, item, -1)
      addStock(state.counter.items, item, 1)
      state.player.tray = inventoryTotal(state.player.trayItems)
      state.counter.stock = inventoryTotal(state.counter.items)
      state.player.trayWobble = Math.max(state.player.trayWobble, .8)
      emit(state, 'drop', counter, { item, from })
      if (front && !active.some(customer => customer.order.item === item)) {
        emit(state, 'reject', counter, { item, expectedItem: front.order.item, reason: 'wrong-item' })
      }
    }
  }

  updateCustomers(state, dt)
  updateHelper(state, dt)
  updateCoins(state, dt)
  state.events.forEach(event => { event.age += dt })
  state.events = state.events.filter(event => event.age < .9)
  state.shift.remaining = Math.max(0, state.shift.remaining - dt)
  if (state.shift.remaining < 1e-9) finishShift(state)
}

function updateHelper(state: GameState, dt: number): void {
  const interval = helperInterval(state)
  const front = state.customers.find(customer => !customer.served && !customer.missed)
  const helper = state.skin.helper
  const recipe = front && itemFor(state.skin, front.order.item).recipe
  if (interval === null || !front || !helper || recipe?.station !== helper.prepStation) {
    state.helper.targetCustomerId = null
    state.helper.remaining = interval ?? 0
    return
  }
  if (state.helper.targetCustomerId !== front.id) {
    state.helper.targetCustomerId = front.id
    state.helper.remaining = interval
    return
  }

  state.helper.remaining = Math.max(0, state.helper.remaining - dt)
  if (state.helper.remaining > 0) return

  if (stagedProducts(state, front.order.item) >= front.order.quantity
    || hasRecipeInputs(state.player.trayItems, recipe.inputs)) return
  const prep = state.prepStations[helper.prepStation]
  const station = state.skin.prepStations[helper.prepStation]
  if (!prep || !station || prep.job || inventoryTotal(prep.outputs) >= station.capacity) return

  const ingredients = Object.entries(recipe.inputs).map(([item, quantity]) => {
    const source = Object.entries(state.sources).find(([, candidate]) => candidate.item === item)
    return source && source[1].stock >= quantity ? [source[1], quantity] as const : null
  })
  if (ingredients.some(ingredient => ingredient === null)) return
  for (const ingredient of ingredients) {
    if (ingredient) ingredient[0].stock -= ingredient[1]
  }
  prep.job = { item: front.order.item, remaining: prepSeconds(state, front.order.item), assisted: true }
  state.helper.remaining = interval
  emit(state, 'prep-start', prepPoint(state.skin, helper.prepStation), {
    item: front.order.item,
    station: helper.prepStation,
    source: 'helper',
  })
}

function updatePrepStations(state: GameState, dt: number, capacity: number): void {
  for (const [stationId, prep] of Object.entries(state.prepStations)) {
    const point = prepPoint(state.skin, stationId)
    if (!near(state.player, point)) continue

    const output = maybeFirstStock(state.skin, prep.outputs)
    if (state.pickupCooldown === 0 && output && inventoryTotal(state.player.trayItems) < capacity) {
      addStock(prep.outputs, output, -1)
      addStock(state.player.trayItems, output, 1)
      state.player.tray = inventoryTotal(state.player.trayItems)
      state.pickupCooldown = INTERACTION_COOLDOWN
      state.player.trayWobble = Math.max(state.player.trayWobble, .65)
      emit(state, 'pickup', state.player, {
        item: output,
        station: stationId,
        from: { x: point.x, y: point.y },
      })
      return
    }

    if (prep.job) {
      prep.job.remaining = Math.max(0, prep.job.remaining - dt)
      if (prep.job.remaining === 0) {
        const item = prep.job.item
        addStock(prep.outputs, item, 1)
        prep.job = null
        emit(state, 'prep-ready', point, { item, station: stationId })
      }
      return
    }

    if (state.pickupCooldown > 0 || inventoryTotal(prep.outputs) >= state.skin.prepStations[stationId].capacity) return
    const item = matchingRecipe(state, stationId)
    if (!item) return
    const recipe = itemFor(state.skin, item).recipe
    if (!recipe) return
    for (const [input, quantity] of Object.entries(recipe.inputs)) addStock(state.player.trayItems, input, -quantity)
    state.player.tray = inventoryTotal(state.player.trayItems)
    prep.job = { item, remaining: prepSeconds(state, item) }
    state.pickupCooldown = INTERACTION_COOLDOWN
    emit(state, 'prep-start', point, { item, station: stationId })
    return
  }
}

function updateCustomers(state: GameState, dt: number): void {
  const register = stationPoint(state.skin, 'register')
  state.spawnTimer -= dt
  if (state.spawnTimer <= 0 && state.customers.filter(item => !item.served && !item.missed).length < 4) {
    const id = state.nextOrder + 1
    state.customers.push(customer(state.skin, state.save, state.rules, id, state.nextOrder))
    state.nextOrder++
    state.spawnTimer = state.rules.spawnInterval
  }

  const brokenStreak = state.shift.streak
  let walkedOut: Customer | undefined
  state.customers.filter(item => !item.served && !item.missed).forEach(item => {
    item.patience = Math.max(0, item.patience - dt)
    if (item.patience > 0) return
    item.missed = true
    state.shift.missed++
    walkedOut ??= item
  })
  if (walkedOut) {
    state.shift.streak = 0
    state.counter.serveTimer = 0
    state.counter.servingCustomerId = null
    if (brokenStreak > 0) emit(state, 'combo-break', walkedOut, { streak: brokenStreak })
  }

  const waiting = state.customers.filter(item => !item.served && !item.missed)
  waiting.forEach((item, index) => {
    const targetX = 610 + index * 24
    item.x += (targetX - item.x) * Math.min(1, dt * 5)
    item.y = 550 + index * 25
  })

  const target = waiting.slice(0, state.rules.activeOrderWindow)
    .find(customer => (state.counter.items[customer.order.item] ?? 0) >= customer.order.quantity)
  if (target) {
    if (state.counter.servingCustomerId !== target.id) {
      state.counter.servingCustomerId = target.id
      state.counter.serveTimer = 0
    }
    state.counter.serveTimer += dt
    if (state.counter.serveTimer >= .7) {
      addStock(state.counter.items, target.order.item, -target.order.quantity)
      state.counter.stock = inventoryTotal(state.counter.items)
      state.counter.serveTimer = 0
      state.counter.servingCustomerId = null
      target.served = true
      state.shift.served++
      state.shift.streak++
      state.shift.bestStreak = Math.max(state.shift.bestStreak, state.shift.streak)
      const tip = tipFor(target.patience, customerPatience(state))
      const combo = comboBonus(state, state.shift.streak)
      const payout = target.order.price + tip + combo
      emit(state, 'pay', register, { amount: payout, tip, combo, streak: state.shift.streak, item: target.order.item })
      for (let i = 0; i < 4; i++) {
        const angle = -2.7 + i * .45
        state.flyingCoins.push({
          id: state.time * 1000 + i,
          x: register.x,
          y: register.y - 35,
          vx: Math.cos(angle) * (80 + i * 12),
          vy: Math.sin(angle) * (95 + i * 8),
          age: 0,
          collected: false,
          value: Math.floor(payout / 4) + (i < payout % 4 ? 1 : 0),
        })
      }
    }
  } else {
    state.counter.serveTimer = 0
    state.counter.servingCustomerId = null
  }

  state.customers.forEach(item => {
    if (!item.served && !item.missed) return
    item.exit += dt
    item.x += 115 * dt
    item.y += (item.missed ? 18 : -18) * dt
  })
  state.customers = state.customers.filter(item => item.exit < 2)
}

function updateCoins(state: GameState, dt: number): void {
  const target = { x: state.player.x, y: state.player.y - 55 }
  for (const coin of state.flyingCoins) {
    if (coin.collected) continue
    coin.age += dt
    if (coin.age < .55) {
      coin.vy += 240 * dt
      coin.x = clamp(coin.x + coin.vx * dt, 15, WORLD.width - 15)
      coin.y = clamp(coin.y + coin.vy * dt, 15, WORLD.height - 15)
    } else if (distance(coin, target) < 140) {
      const pull = Math.min(1, dt * 8)
      coin.x += (target.x - coin.x) * pull
      coin.y += (target.y - coin.y) * pull
      if (distance(coin, target) < 25) {
        coin.collected = true
        state.save.coins += coin.value
        state.save.lifetimeCash += coin.value
        state.shift.revenue += coin.value
      }
    }
  }
  state.flyingCoins = state.flyingCoins.filter(coin => !coin.collected)
}

function emit(
  state: GameState,
  kind: EventKind,
  at: Point,
  details: Pick<GameEvent, 'from' | 'amount' | 'tip' | 'combo' | 'streak' | 'item' | 'expectedItem' | 'source' | 'station' | 'reason'> = {},
): void {
  state.events.push({ kind, x: at.x, y: at.y, age: 0, createdAt: state.time, ...details })
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function emptyInventory(skin: GameSkin): Inventory {
  return Object.fromEntries(Object.keys(skin.items).map(item => [item, 0]))
}

function addStock(inventory: Inventory, item: string, quantity: number): void {
  inventory[item] = Math.max(0, (inventory[item] ?? 0) + quantity)
}

function firstStock(skin: GameSkin, inventory: Inventory): string {
  const item = maybeFirstStock(skin, inventory)
  if (!item) throw new Error('inventory is empty')
  return item
}

function maybeFirstStock(skin: GameSkin, inventory: Inventory): string | undefined {
  return Object.keys(skin.items).find(id => (inventory[id] ?? 0) > 0)
}

function matchingRecipe(state: GameState, station: string): string | undefined {
  // Use the exact current + next-two window shown by the UI, including deck
  // previews that have not spawned yet. Planning ahead must beat incidental
  // JSON insertion order when a larger tray can satisfy several recipes.
  const front = state.customers.find(customer => !customer.served && !customer.missed)?.order
  const requested = [front, ...upcomingOrders(state, 2)]
    .filter((order): order is CustomerOrder => Boolean(order))
    .map(order => order.item)
  const items = [...new Set([...requested, ...Object.keys(state.skin.items)])]
  return items.find(item => {
    const recipe = state.skin.items[item].recipe
    return recipe?.station === station
      && Object.entries(recipe.inputs).every(([input, quantity]) => (state.player.trayItems[input] ?? 0) >= quantity)
  })
}

function hasRecipeInputs(inventory: Inventory, inputs: Inventory): boolean {
  return Object.entries(inputs).every(([item, quantity]) => (inventory[item] ?? 0) >= quantity)
}

function stagedProducts(state: GameState, item: string): number {
  return (state.player.trayItems[item] ?? 0)
    + (state.counter.items[item] ?? 0)
    + Object.values(state.prepStations).reduce((total, prep) =>
      total + (prep.outputs[item] ?? 0) + (prep.job?.item === item ? 1 : 0), 0)
}

function hasAvailablePrepCapacity(state: GameState): boolean {
  return Object.values(state.skin.items).some(item => {
    const recipe = item.recipe
    if (!recipe || !Object.entries(recipe.inputs)
      .every(([input, quantity]) => (state.player.trayItems[input] ?? 0) >= quantity)) return false
    const prep = state.prepStations[recipe.station]
    return prep && inventoryTotal(prep.outputs) + (prep.job ? 1 : 0) < state.skin.prepStations[recipe.station].capacity
  })
}

function rawToReturn(state: GameState, requested?: string): string | undefined {
  const inputs = requested ? itemFor(state.skin, requested).recipe?.inputs ?? {} : {}
  const raw = Object.keys(state.skin.items)
    .filter(item => !state.skin.items[item].recipe && (state.player.trayItems[item] ?? 0) > 0)
  return raw.find(item => !inputs[item])
    ?? raw.find(item => (state.player.trayItems[item] ?? 0) > (inputs[item] ?? 0))
    ?? raw[0]
}

export function inventoryTotal(inventory: Inventory): number {
  return Object.values(inventory).reduce((total, quantity) => total + quantity, 0)
}

export function upcomingOrders(state: GameState, count: number): CustomerOrder[] {
  const limit = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  const waiting = state.customers.filter(customer => !customer.served && !customer.missed)
  const orders = waiting.slice(1, limit + 1).map(customer => customer.order)
  for (let index = state.nextOrder; orders.length < limit; index++) {
    orders.push(orderAt(state.skin, state.rules, index))
  }
  return orders
}

export function runFor(state: GameState, seconds: number, input: Input = { x: 0, y: 0 }): void {
  for (let left = seconds; left > 0 && state.phase === 'playing'; left -= .05) step(state, Math.min(.05, left), input)
}

export function startShift(state: GameState): void {
  if (state.phase === 'ready') state.phase = 'playing'
}

function resetShift(state: GameState, phase: 'ready' | 'playing'): void {
  const fresh = createGame(state.skin, state.save)
  Object.assign(state, fresh)
  state.phase = phase
}

export function retryShift(state: GameState): boolean {
  if (state.phase !== 'results' && state.phase !== 'shop') return false
  resetShift(state, 'playing')
  return true
}

export function enterShop(state: GameState): boolean {
  if (state.phase !== 'results') return false
  state.phase = 'shop'
  return true
}

export function leaveShop(state: GameState): boolean {
  if (state.phase !== 'shop') return false
  state.phase = 'results'
  return true
}

export function purchaseUpgrade(state: GameState, id: string): boolean {
  if (state.phase !== 'shop') return false
  const upgrade = state.skin.upgrades.find(candidate => candidate.id === id)
  if (!upgrade) return false
  const offer = upgradeOffer(state, upgrade)
  if (offer.price === null || !offer.affordable) return false
  state.save.coins -= offer.price
  state.save.upgrades[id] = offer.level + 1
  return true
}

export function nextDay(state: GameState): boolean {
  if (state.phase !== 'shop' || !goalMet(state)) return false
  const finalDay = state.skin.days.length - 1
  if (state.skin.scoreChase && state.save.scoreChaseLevel > 0) {
    state.save.scoreChaseLevel = Math.min(999, state.save.scoreChaseLevel + 1)
  } else if (state.skin.scoreChase && state.save.currentDay >= finalDay) {
    state.save.scoreChaseLevel = 1
  } else {
    state.save.currentDay = Math.min(finalDay, state.save.currentDay + 1)
  }
  backfillDayUnlocks(state.skin, state.save)
  resetShift(state, 'ready')
  return true
}

export function tipFor(remaining: number, patience: number): number {
  if (remaining <= 0 || patience <= 0) return 0
  return Math.ceil(clamp(remaining / patience, 0, 1) * 3)
}

export function comboBonus(state: GameState, streak: number): number {
  return state.skin.comboTiers.reduce((bonus, tier) => streak >= tier.streak ? tier.bonus : bonus, 0)
}

export function goalMet(state: GameState): boolean {
  return state.shift.revenue >= state.rules.cashGoal
}

export function starsFor(skin: GameSkin, revenue: number, dayIndex = 0): number {
  const day = skin.days[clamp(Math.floor(dayIndex), 0, skin.days.length - 1)]
  if (!day) throw new Error('campaign has no days')
  return day.starThresholds.filter(threshold => revenue >= threshold).length
}

function finishShift(state: GameState): void {
  if (state.phase !== 'playing') return
  const dayIndex = clamp(Math.floor(state.save.currentDay), 0, state.skin.days.length - 1)
  state.phase = 'results'
  state.shift.remaining = 0
  state.shift.stars = state.rules.starThresholds.filter(threshold => state.shift.revenue >= threshold).length
  if (state.rules.kind === 'campaign') {
    state.save.dayBestRevenue[dayIndex] = Math.max(state.save.dayBestRevenue[dayIndex], state.shift.revenue)
    state.save.dayStars[dayIndex] = Math.max(state.save.dayStars[dayIndex], state.shift.stars)
    state.save.bestRevenue = Math.max(state.save.bestRevenue, state.shift.revenue)
    state.save.bestStars = Math.max(state.save.bestStars, state.shift.stars)
  } else {
    state.save.scoreChaseBest = Math.max(state.save.scoreChaseBest, state.shift.revenue)
  }
  state.player.moving = false
}

function activeShiftRules(skin: GameSkin, save: SaveV1): ActiveShiftRules {
  const chase = skin.scoreChase
  if (chase && save.scoreChaseLevel > 0) {
    if (chase.orderDeck.length === 0) throw new Error('score chase order deck is empty')
    const level = clamp(Math.floor(save.scoreChaseLevel), 1, 999)
    const step = level - 1
    const goal = chase.cashGoal + chase.goalStep * step
    const rotation = step % chase.orderDeck.length
    return {
      kind: 'score-chase',
      level,
      id: chase.id,
      label: chase.label,
      challenge: chase.challenge,
      unlockBanner: `RUSH ${Math.min(999, level + 1)} UNLOCKED`,
      duration: chase.duration,
      cashGoal: goal,
      starThresholds: [goal, goal + chase.starGap, goal + chase.starGap * 2],
      customerPatience: Math.max(chase.minCustomerPatience, chase.customerPatience - chase.patienceStep * step),
      spawnInterval: Math.max(chase.minSpawnInterval, chase.spawnInterval - chase.spawnStep * step),
      activeOrderWindow: boundedOrderWindow(chase.activeOrderWindow),
      orderDeck: [...chase.orderDeck.slice(rotation), ...chase.orderDeck.slice(0, rotation)],
    }
  }
  const dayIndex = clamp(Math.floor(save.currentDay), 0, skin.days.length - 1)
  const day = skin.days[dayIndex]
  if (!day) throw new Error('campaign has no days')
  return {
    ...day,
    kind: 'campaign',
    level: dayIndex + 1,
    activeOrderWindow: boundedOrderWindow(day.activeOrderWindow),
    starThresholds: [...day.starThresholds],
    orderDeck: [...day.orderDeck],
  }
}

function boundedOrderWindow(value: number | undefined): number {
  return clamp(Math.floor(typeof value === 'number' && Number.isFinite(value) ? value : 1), 1, 3)
}
