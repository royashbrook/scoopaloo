import type { CustomerOrder, GameSkin } from './skin'
import { effectTotal, itemFor, nextUpgrade, producerPoint, stationPoint, upgradeSpot } from './skin'

export type Point = { x: number; y: number }
export type Input = Point
export type EventKind = 'pickup' | 'drop' | 'pour' | 'pay' | 'reject' | 'build'
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
}

export type ShiftPhase = 'ready' | 'playing' | 'results'
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
  amount?: number
  tip?: number
  item?: string
  expectedItem?: string
  source?: string
}

export type ProducerState = { item: string; stock: number; timer: number }

export type GameState = {
  skin: GameSkin
  phase: ShiftPhase
  shift: ShiftState
  time: number
  player: Point & { facing: number; moving: boolean; tray: number; trayItems: Inventory; trayWobble: number }
  sources: Record<string, ProducerState>
  /** Compatibility alias for the original renderer; sources is authoritative. */
  machine: ProducerState
  counter: { stock: number; items: Inventory; serveTimer: number }
  customers: Customer[]
  flyingCoins: FlyingCoin[]
  events: GameEvent[]
  spawnTimer: number
  nextOrder: number
  pickupCooldown: number
  lifetimeCoins: number
  save: SaveV1
}

export const WORLD = { width: 960, height: 640 }
export const defaultSave = (skin: GameSkin): SaveV1 => ({
  version: 1,
  coins: 0,
  unlockedStations: [...new Set(skin.progression.startingStations)],
  upgrades: Object.fromEntries(skin.upgrades.map(upgrade => [upgrade.id, 0])),
  skin: skin.id,
  text: true,
  bestRevenue: 0,
  bestStars: 0,
})

// Effects are skin data: every number below starts at the engine's base and adds
// whatever the owned upgrades declare, so a skin can retune without engine edits.
export const walkSpeed = (state: GameState): number => 185 + effectTotal(state.skin, state.save.upgrades, 'walkSpeed')
export const trayCapacity = (state: GameState): number => 2 + effectTotal(state.skin, state.save.upgrades, 'trayCapacity')
export const machineInterval = (state: GameState, source = state.skin.progression.startingStation): number =>
  Math.max(.4, state.skin.producers[source].interval - effectTotal(state.skin, state.save.upgrades, 'machineInterval'))

export function createGame(skin: GameSkin, save: SaveV1 = defaultSave(skin)): GameState {
  const sources = Object.fromEntries(Object.entries(skin.items).map(([item, definition]) => {
    const source = definition.recipe.source
    return [source, { item, stock: 0, timer: skin.producers[source].interval }]
  }))
  const machine = sources[skin.progression.startingStation]
  if (!machine) throw new Error(`unknown starting producer: ${skin.progression.startingStation}`)
  return {
    skin,
    phase: 'ready',
    shift: freshShift(skin),
    time: 0,
    player: { x: 430, y: 470, facing: 1, moving: false, tray: 0, trayItems: emptyInventory(skin), trayWobble: 0 },
    sources,
    machine,
    counter: { stock: 0, items: emptyInventory(skin), serveTimer: 0 },
    customers: [customer(skin, 1, 0)],
    flyingCoins: [],
    events: [],
    spawnTimer: 2,
    nextOrder: 1,
    pickupCooldown: 0,
    lifetimeCoins: save.coins,
    save: structuredClone(save),
  }
}

function freshShift(skin: GameSkin): ShiftState {
  return {
    remaining: skin.shift.duration,
    revenue: 0,
    served: 0,
    missed: 0,
    streak: 0,
    bestStreak: 0,
    stars: 0,
  }
}

function customer(skin: GameSkin, id: number, look: number): Customer {
  const request = skin.orderDeck[look % skin.orderDeck.length]
  if (!request) throw new Error('order deck is empty')
  const item = itemFor(skin, request.item)
  return {
    id,
    look: look % 4,
    served: false,
    missed: false,
    patience: skin.shift.customerPatience,
    order: {
      ...request,
      label: item.label,
      price: item.price * request.quantity,
      icon: item.icon,
      color: item.color,
    },
    x: 900,
    y: 345,
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
    state.player.y = clamp(state.player.y + ny * speed * .72 * dt, 205, WORLD.height - 48)
    if (Math.abs(nx) > .1) state.player.facing = Math.sign(nx)
  }
  state.player.trayWobble += dt * (state.player.moving ? 12 : 4)

  for (const [sourceId, source] of Object.entries(state.sources)) {
    source.timer -= dt
    const producer = state.skin.producers[sourceId]
    if (source.timer <= 0 && source.stock < producer.capacity) {
      source.stock++
      source.timer = machineInterval(state, sourceId)
      emit(state, 'pour', producerPoint(state.skin, sourceId), { item: source.item, source: sourceId })
    }
  }

  const capacity = trayCapacity(state)
  const counter = stationPoint(state.skin, 'counter')
  for (const [sourceId, source] of Object.entries(state.sources)) {
    if (state.pickupCooldown > 0 || !near(state.player, producerPoint(state.skin, sourceId))
      || source.stock <= 0 || inventoryTotal(state.player.trayItems) >= capacity) continue
    source.stock--
    addStock(state.player.trayItems, source.item, 1)
    state.player.tray = inventoryTotal(state.player.trayItems)
    state.pickupCooldown = .35
    emit(state, 'pickup', state.player, { item: source.item, source: sourceId })
    break
  }

  if (state.pickupCooldown === 0 && near(state.player, counter) && inventoryTotal(state.player.trayItems) > 0) {
    const front = state.customers.find(item => !item.served && !item.missed)
    const item = front && (state.player.trayItems[front.order.item] ?? 0) > 0
      ? front.order.item
      : firstStock(state.skin, state.player.trayItems)
    addStock(state.player.trayItems, item, -1)
    addStock(state.counter.items, item, 1)
    state.player.tray = inventoryTotal(state.player.trayItems)
    state.counter.stock = inventoryTotal(state.counter.items)
    state.pickupCooldown = .35
    emit(state, 'drop', counter, { item })
    if (front && front.order.item !== item) {
      emit(state, 'reject', counter, { item, expectedItem: front.order.item })
    }
  }

  updateCustomers(state, dt)
  updateCoins(state, dt)
  updateBuildSpot(state)
  state.events.forEach(event => { event.age += dt })
  state.events = state.events.filter(event => event.age < .9)
  state.shift.remaining = Math.max(0, state.shift.remaining - dt)
  if (state.shift.remaining < 1e-9) finishShift(state)
}

function updateCustomers(state: GameState, dt: number): void {
  const register = stationPoint(state.skin, 'register')
  state.spawnTimer -= dt
  if (state.spawnTimer <= 0 && state.customers.filter(item => !item.served && !item.missed).length < 4) {
    const id = state.nextOrder + 1
    state.customers.push(customer(state.skin, id, state.nextOrder))
    state.nextOrder++
    state.spawnTimer = 3.8
  }

  let walkedOut = false
  state.customers.filter(item => !item.served && !item.missed).forEach(item => {
    item.patience = Math.max(0, item.patience - dt)
    if (item.patience > 0) return
    item.missed = true
    state.shift.missed++
    state.shift.streak = 0
    walkedOut = true
  })
  if (walkedOut) state.counter.serveTimer = 0

  const waiting = state.customers.filter(item => !item.served && !item.missed)
  waiting.forEach((item, index) => {
    const targetX = 815 + index * 28
    item.x += (targetX - item.x) * Math.min(1, dt * 5)
    item.y = 350 + index * 25
  })

  const front = waiting[0]
  if (front && (state.counter.items[front.order.item] ?? 0) >= front.order.quantity) {
    state.counter.serveTimer += dt
    if (state.counter.serveTimer >= .7) {
      addStock(state.counter.items, front.order.item, -front.order.quantity)
      state.counter.stock = inventoryTotal(state.counter.items)
      state.counter.serveTimer = 0
      front.served = true
      state.shift.served++
      state.shift.streak++
      state.shift.bestStreak = Math.max(state.shift.bestStreak, state.shift.streak)
      const tip = tipFor(front.patience, state.skin.shift.customerPatience)
      const payout = front.order.price + tip
      emit(state, 'pay', register, { amount: payout, tip, item: front.order.item })
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
        state.lifetimeCoins += coin.value
        state.shift.revenue += coin.value
      }
    }
  }
  state.flyingCoins = state.flyingCoins.filter(coin => !coin.collected)
}

// Purchases follow the skin's declared order: only the NEXT unowned upgrade has a
// live spot, so a later spot cannot be bought early no matter where the player
// stands. Buying flips the owned level, which advances nextUpgrade, so a held
// position cannot deduct twice.
function updateBuildSpot(state: GameState): void {
  const upgrade = nextUpgrade(state.skin, state.save.upgrades)
  if (!upgrade || state.save.coins < upgrade.price) return
  const spot = upgradeSpot(upgrade)
  if (!near(state.player, spot, 76)) return
  state.save.coins -= upgrade.price
  state.save.upgrades[upgrade.id] = 1
  state.save.unlockedStations.push(upgrade.unlocks)
  emit(state, 'build', spot)
}

function emit(
  state: GameState,
  kind: EventKind,
  at: Point,
  details: Pick<GameEvent, 'amount' | 'tip' | 'item' | 'expectedItem' | 'source'> = {},
): void {
  state.events.push({ kind, x: at.x, y: at.y, age: 0, ...details })
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
  const item = Object.keys(skin.items).find(id => (inventory[id] ?? 0) > 0)
  if (!item) throw new Error('inventory is empty')
  return item
}

export function inventoryTotal(inventory: Inventory): number {
  return Object.values(inventory).reduce((total, quantity) => total + quantity, 0)
}

export function runFor(state: GameState, seconds: number, input: Input = { x: 0, y: 0 }): void {
  for (let left = seconds; left > 0 && state.phase === 'playing'; left -= .05) step(state, Math.min(.05, left), input)
}

export function startShift(state: GameState): void {
  if (state.phase === 'ready') state.phase = 'playing'
}

export function retryShift(state: GameState): void {
  const fresh = createGame(state.skin, state.save)
  Object.assign(state, fresh)
  state.phase = 'playing'
}

export function tipFor(remaining: number, patience: number): number {
  if (remaining <= 0 || patience <= 0) return 0
  return Math.ceil(clamp(remaining / patience, 0, 1) * 3)
}

export function goalMet(state: GameState): boolean {
  return state.shift.revenue >= state.skin.shift.cashGoal
}

export function starsFor(skin: GameSkin, revenue: number): number {
  return skin.shift.starThresholds.filter(threshold => revenue >= threshold).length
}

function finishShift(state: GameState): void {
  if (state.phase !== 'playing') return
  state.phase = 'results'
  state.shift.remaining = 0
  state.shift.stars = starsFor(state.skin, state.shift.revenue)
  state.save.bestRevenue = Math.max(state.save.bestRevenue, state.shift.revenue)
  state.save.bestStars = Math.max(state.save.bestStars, state.shift.stars)
  state.player.moving = false
}
