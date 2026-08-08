import type { GameSkin } from './skin'
import { stationPoint } from './skin'

export type Point = { x: number; y: number }
export type Input = Point
export type EventKind = 'pickup' | 'drop' | 'pour' | 'pay' | 'build'

export type SaveV1 = {
  version: 1
  coins: number
  unlockedStations: string[]
  upgrades: Record<string, number>
  skin: string
  text: boolean
}

export type Customer = {
  id: number
  look: number
  served: boolean
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
}

export type GameEvent = Point & { kind: EventKind; age: number }

export type GameState = {
  skin: GameSkin
  time: number
  player: Point & { facing: number; moving: boolean; tray: number; trayWobble: number }
  machine: { stock: number; timer: number }
  counter: { stock: number; serveTimer: number }
  customers: Customer[]
  flyingCoins: FlyingCoin[]
  events: GameEvent[]
  spawnTimer: number
  pickupCooldown: number
  lifetimeCoins: number
  save: SaveV1
}

export const WORLD = { width: 960, height: 640 }
export const defaultSave = (skin: GameSkin): SaveV1 => ({
  version: 1,
  coins: 0,
  unlockedStations: [skin.progression.startingStation],
  upgrades: { shoes: 0, tray: 0 },
  skin: skin.id,
  text: false,
})

export function createGame(skin: GameSkin, save: SaveV1 = defaultSave(skin)): GameState {
  return {
    skin,
    time: 0,
    player: { x: 430, y: 470, facing: 1, moving: false, tray: 0, trayWobble: 0 },
    machine: { stock: 0, timer: 1.4 },
    counter: { stock: 0, serveTimer: 0 },
    customers: [customer(1, 0)],
    flyingCoins: [],
    events: [],
    spawnTimer: 2,
    pickupCooldown: 0,
    lifetimeCoins: save.coins,
    save: structuredClone(save),
  }
}

function customer(id: number, look: number): Customer {
  return { id, look: look % 4, served: false, x: 905, y: 345, exit: 0 }
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const near = (a: Point, b: Point, radius = 68) => distance(a, b) < radius

export function step(state: GameState, seconds: number, input: Input = { x: 0, y: 0 }): void {
  const dt = Math.min(Math.max(seconds, 0), 0.05)
  state.time += dt
  state.pickupCooldown = Math.max(0, state.pickupCooldown - dt)

  const length = Math.hypot(input.x, input.y)
  const speed = 185 + state.save.upgrades.shoes * 25
  const nx = length > 1 ? input.x / length : input.x
  const ny = length > 1 ? input.y / length : input.y
  state.player.moving = length > 0.05
  if (state.player.moving) {
    state.player.x = clamp(state.player.x + nx * speed * dt, 55, WORLD.width - 55)
    state.player.y = clamp(state.player.y + ny * speed * .72 * dt, 205, WORLD.height - 48)
    if (Math.abs(nx) > .1) state.player.facing = Math.sign(nx)
  }
  state.player.trayWobble += dt * (state.player.moving ? 12 : 4)

  state.machine.timer -= dt
  if (state.machine.timer <= 0 && state.machine.stock < 3) {
    state.machine.stock++
    state.machine.timer = 1.7
    emit(state, 'pour', stationPoint(state.skin, 'machine'))
  }

  const capacity = 2 + Math.min(1, state.save.upgrades.tray)
  const machine = stationPoint(state.skin, 'machine')
  const counter = stationPoint(state.skin, 'counter')
  if (state.pickupCooldown === 0 && near(state.player, machine) && state.machine.stock > 0 && state.player.tray < capacity) {
    state.machine.stock--
    state.player.tray++
    state.pickupCooldown = .35
    emit(state, 'pickup', state.player)
  }

  if (state.pickupCooldown === 0 && near(state.player, counter) && state.player.tray > 0) {
    state.player.tray--
    state.counter.stock++
    state.pickupCooldown = .35
    emit(state, 'drop', counter)
  }

  updateCustomers(state, dt)
  updateCoins(state, dt)
  updateBuildSpot(state, dt)
  state.events.forEach(event => { event.age += dt })
  state.events = state.events.filter(event => event.age < .9)
}

function updateCustomers(state: GameState, dt: number): void {
  const register = stationPoint(state.skin, 'register')
  state.spawnTimer -= dt
  if (state.spawnTimer <= 0 && state.customers.length < 4) {
    const id = Math.max(0, ...state.customers.map(item => item.id)) + 1
    state.customers.push(customer(id, id))
    state.spawnTimer = 3.8
  }

  const waiting = state.customers.filter(item => !item.served)
  waiting.forEach((item, index) => {
    const targetX = 815 + index * 60
    item.x += (targetX - item.x) * Math.min(1, dt * 5)
    item.y = 350 + index * 25
  })

  const front = waiting[0]
  if (front && state.counter.stock > 0) {
    state.counter.serveTimer += dt
    if (state.counter.serveTimer >= .7) {
      state.counter.stock--
      state.counter.serveTimer = 0
      front.served = true
      emit(state, 'pay', register)
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
        })
      }
    }
  } else {
    state.counter.serveTimer = 0
  }

  state.customers.forEach(item => {
    if (!item.served) return
    item.exit += dt
    item.x += 115 * dt
    item.y -= 18 * dt
  })
  state.customers = state.customers.filter(item => item.exit < 2)
}

function updateCoins(state: GameState, dt: number): void {
  for (const coin of state.flyingCoins) {
    if (coin.collected) continue
    coin.age += dt
    if (coin.age < .55) {
      coin.vy += 240 * dt
      coin.x += coin.vx * dt
      coin.y += coin.vy * dt
    } else if (distance(coin, state.player) < 140 || coin.age > 2.4) {
      const pull = Math.min(1, dt * 8)
      coin.x += (state.player.x - coin.x) * pull
      coin.y += (state.player.y - 55 - coin.y) * pull
      if (distance(coin, state.player) < 25 || coin.age > 3.3) {
        coin.collected = true
        state.save.coins++
        state.lifetimeCoins++
      }
    }
  }
  state.flyingCoins = state.flyingCoins.filter(coin => !coin.collected)
}

function updateBuildSpot(state: GameState, dt: number): void {
  const ready = state.save.coins >= 8 && state.save.upgrades.shoes === 0
  if (!ready || !near(state.player, stationPoint(state.skin, 'build'), 76)) return
  state.save.coins -= 8
  state.save.upgrades.shoes = 1
  state.save.unlockedStations.push(state.skin.progression.firstBuildUnlock)
  emit(state, 'build', stationPoint(state.skin, 'build'))
  state.player.y -= 20 * dt
}

function emit(state: GameState, kind: EventKind, at: Point): void {
  state.events.push({ kind, x: at.x, y: at.y, age: 0 })
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function runFor(state: GameState, seconds: number, input: Input = { x: 0, y: 0 }): void {
  for (let left = seconds; left > 0; left -= .05) step(state, Math.min(.05, left), input)
}
