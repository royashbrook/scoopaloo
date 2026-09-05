import type { Point } from './engine'

export const FLOOR_KEY = 'scoopaloo.shop-floor.v1'
export const FLOOR = {
  width: 640, height: 960,
  scoop: { x: 150, y: 450 },
  counters: [{ x: 475, y: 415 }, { x: 475, y: 800 }, { x: 285, y: 835 }],
  patio: { x: 320, y: 620, price: 40 },
  hire: { x: 155, y: 800, price: 60 },
  party: { x: 320, y: 590, price: 160, guests: 6 },
  entranceX: 545, staffDoor: { x: 535, y: 600 },
  price: 20, speed: 260, capacity: 3, reach: 54,
} as const

type SavedWalker = Point & { cones: number }
export type FloorSave = {
  version: 1; cash: number; served: number; patio: boolean; helper: boolean
  party?: boolean; partyServed?: number; player?: SavedWalker; pip?: SavedWalker
}
export type Walker = Point & {
  direction: 'down' | 'up' | 'left' | 'right'; distance: number; moving: boolean
  cones: number; cooldown: number
}
export type FloorEvent = Point & {
  kind: 'pickup' | 'pay' | 'build' | 'hire' | 'party'; age: number; from?: Point; helper?: boolean
}
export type FloorCustomer = Point & { id: number; lane: number; leaving: boolean; age: number }
export type FloorState = {
  save: FloorSave; time: number; player: Walker; helper: Walker; customers: FloorCustomer[]
  events: FloorEvent[]; nextCustomer: number; buildHold: number; paused: boolean; helperServed: number
}

export const freshFloorSave = (): FloorSave => ({ version: 1, cash: 0, served: 0, patio: false, helper: false })
export function validFloorSave(value: unknown): value is FloorSave {
  if (!value || typeof value !== 'object') return false
  const s = value as FloorSave
  return s.version === 1 && Number.isSafeInteger(s.cash) && s.cash >= 0
    && Number.isSafeInteger(s.served) && s.served >= 0
    && typeof s.patio === 'boolean' && typeof s.helper === 'boolean' && (!s.helper || s.patio)
    && (s.party === undefined || typeof s.party === 'boolean' && (!s.party || s.helper))
    && (s.partyServed === undefined || Number.isInteger(s.partyServed) && s.partyServed >= 0
      && s.partyServed <= FLOOR.party.guests && (s.partyServed === 0 || s.party === true))
    && [s.player, s.pip].every(p => p === undefined || p !== null && typeof p === 'object'
      && Number.isFinite(p.x) && p.x >= 110 && p.x <= 535
      && Number.isFinite(p.y) && p.y >= 405 && p.y <= (s.patio ? 875 : 650)
      && Number.isInteger(p.cones) && p.cones >= 0 && p.cones <= FLOOR.capacity)
}

// The preview owns a different key. It never reads, migrates or resets campaign progress.
export function floorStorage(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  let snapshot: string | null = null
  let writable = true
  const target = () => storage ?? localStorage
  return {
    load(): FloorSave {
      try {
        snapshot = target().getItem(FLOOR_KEY)
        if (snapshot === null) return freshFloorSave()
        const parsed: unknown = JSON.parse(snapshot)
        if (!validFloorSave(parsed)) throw new Error('unrecognized shop save')
        return { ...parsed }
      } catch {
        writable = false
        return freshFloorSave()
      }
    },
    store(save: FloorSave): boolean {
      if (!writable || !validFloorSave(save)) return false
      try {
        if (target().getItem(FLOOR_KEY) !== snapshot) { writable = false; return false }
        const serialized = JSON.stringify(save)
        if (serialized !== snapshot) target().setItem(FLOOR_KEY, serialized)
        snapshot = serialized
        return true
      } catch { return false }
    },
  }
}

function walker(x: number, y: number): Walker {
  return { x, y, direction: 'down', distance: 0, moving: false, cones: 0, cooldown: 0 }
}
export function createFloor(save = freshFloorSave()): FloorState {
  const { player, pip, ...progress } = save
  const state: FloorState = {
    save: { ...progress }, time: 0,
    player: { ...walker(235, 480), ...player }, helper: { ...walker(FLOOR.staffDoor.x, FLOOR.staffDoor.y), ...pip },
    customers: [], events: [], nextCustomer: 0, buildHold: 0, paused: false, helperServed: 0,
  }
  addCustomer(state, 0, true)
  if (save.patio) addCustomer(state, 1, true)
  if (save.party && !floorComplete(state)) addCustomer(state, 2, true)
  return state
}

export function floorCheckpoint(state: FloorState): FloorSave {
  const position = ({ x, y, cones }: Walker) => ({ x, y, cones })
  return { ...state.save, player: position(state.player), ...(state.save.helper ? { pip: position(state.helper) } : {}) }
}
export const floorComplete = (state: FloorState) => (state.save.partyServed ?? 0) >= FLOOR.party.guests
const customerX = (lane: number) => FLOOR.counters[lane].x + 5

function addCustomer(state: FloorState, lane: number, ready = false): void {
  state.customers.push({ id: state.nextCustomer++, lane, x: ready ? customerX(lane) : FLOOR.entranceX,
    y: [315, 705, 750][lane], leaving: false, age: 0 })
}
const near = (a: Point, b: Point, radius: number = FLOOR.reach) => Math.hypot(a.x - b.x, a.y - b.y) <= radius
function move(actor: Walker, input: Point, dt: number, speed: number, patio: boolean): void {
  const magnitude = Math.max(1, Math.hypot(input.x, input.y))
  const dx = input.x / magnitude * speed * dt, dy = input.y / magnitude * speed * dt
  const x = Math.max(110, Math.min(535, actor.x + dx))
  const y = Math.max(405, Math.min(patio ? 875 : 650, actor.y + dy))
  const distance = Math.hypot(x - actor.x, y - actor.y)
  actor.moving = distance > .01
  if (actor.moving) {
    actor.direction = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'up' : 'down'
    actor.distance += distance
  }
  actor.x = x; actor.y = y
}

function interact(state: FloorState, actor: Walker, dt: number, helper = false): void {
  actor.cooldown = Math.max(0, actor.cooldown - dt)
  if (actor.cooldown > 0) return
  if (near(actor, FLOOR.scoop) && actor.cones < FLOOR.capacity) {
    actor.cones++
    actor.cooldown = .2
    state.events.push({ kind: 'pickup', x: actor.x, y: actor.y - 45,
      from: { x: FLOOR.scoop.x, y: FLOOR.scoop.y - 95 }, age: 0, helper })
    return
  }
  if (!actor.cones) return
  const customer = state.customers.find(c => !c.leaving && c.x <= customerX(c.lane) + 1
    && (!helper || c.lane === 0) && near(actor, FLOOR.counters[c.lane]))
  if (!customer) return
  actor.cones--
  actor.cooldown = .3
  customer.leaving = true
  customer.age = 0
  state.save.cash += FLOOR.price
  state.save.served++
  if (customer.lane === 2) state.save.partyServed = (state.save.partyServed ?? 0) + 1
  if (helper) state.helperServed++
  state.events.push({ kind: 'pay', x: FLOOR.counters[customer.lane].x, y: customer.y - 100,
    from: { x: actor.x, y: actor.y - 45 }, age: 0, helper })
}

export function nextFloorPurchase(state: FloorState) {
  return !state.save.patio ? { ...FLOOR.patio, kind: 'patio' as const, label: 'OPEN PATIO' }
    : !state.save.helper ? { ...FLOOR.hire, kind: 'helper' as const, label: 'HIRE PIP' }
    : !state.save.party ? { ...FLOOR.party, kind: 'party' as const, label: 'PARTY TABLE' } : null
}

export function stepFloor(state: FloorState, seconds: number, input: Point = { x: 0, y: 0 }): void {
  if (state.paused || !Number.isFinite(seconds) || seconds <= 0) return
  const dt = Math.min(.05, seconds)
  state.time += dt
  state.events.forEach(event => { event.age += dt })
  state.events = state.events.filter(event => event.age < 1.2)
  move(state.player, input, dt, FLOOR.speed, state.save.patio)
  interact(state, state.player, dt)
  const purchase = nextFloorPurchase(state)
  if (purchase && state.save.cash >= purchase.price && near(state.player, purchase, 48)) {
    state.buildHold += dt
    if (state.buildHold >= .6) {
      state.save.cash -= purchase.price
      state.save[purchase.kind] = true
      const at = purchase.kind === 'helper' ? FLOOR.staffDoor : purchase.kind === 'party' ? FLOOR.counters[2] : purchase
      state.events.push({ x: at.x, y: at.y,
        kind: purchase.kind === 'patio' ? 'build' : purchase.kind === 'helper' ? 'hire' : 'party', age: 0 })
      if (purchase.kind === 'patio') addCustomer(state, 1)
      if (purchase.kind === 'party') addCustomer(state, 2)
      state.buildHold = 0
    }
  } else state.buildHold = 0

  if (state.save.helper) {
    const target = state.helper.cones ? FLOOR.counters[0] : FLOOR.scoop
    const dx = target.x - state.helper.x, dy = target.y - state.helper.y
    const d = Math.hypot(dx, dy)
    move(state.helper, d > 18 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 }, dt, 190, true)
    interact(state, state.helper, dt, true)
  }
  for (const customer of state.customers) {
    customer.age += dt
    customer.x = customer.leaving ? customer.x + 140 * dt : Math.max(customerX(customer.lane), customer.x - 150 * dt)
  }
  state.customers = state.customers.filter(c => c.x < FLOOR.entranceX + 10)
  for (let lane = 0; lane < (state.save.party ? 3 : state.save.patio ? 2 : 1); lane++) {
    if (lane === 2 && floorComplete(state)) continue
    if (!state.customers.some(c => c.lane === lane && (!c.leaving || c.age < .25))) addCustomer(state, lane)
  }
}

export function floorHint(state: FloorState): string {
  const purchase = nextFloorPurchase(state)
  if (floorComplete(state)) return 'You built a little shop. The party is a hit!'
  if (purchase && state.save.cash >= purchase.price) return `Stand on ${purchase.label} to build`
  if (state.save.party) return `Cones for the party! ${state.save.partyServed ?? 0}/${FLOOR.party.guests} friends served`
  if (state.save.helper) return 'Pip serves the shop. You run the patio!'
  if (state.player.cones) return 'Take your cones to a customer'
  return state.save.served === 0 ? 'Drag to the cones. Pick up automatically.' : 'Pick up cones. Keep your shop growing.'
}
