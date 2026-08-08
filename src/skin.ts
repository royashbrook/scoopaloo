import type { Point } from './engine'

export type StationKey = 'machine' | 'counter' | 'register'
export type UpgradeEffect = { kind: 'walkSpeed' | 'trayCapacity' | 'machineInterval'; value: number }
export type SkinOrder = { item: string; quantity: number }
export type SkinItem = {
  label: string
  price: number
  icon: string
  color: string
  recipe: { source: string }
}
export type CustomerOrder = SkinOrder & Pick<SkinItem, 'label' | 'icon' | 'color'> & { price: number }
export type ShiftRules = {
  dayLabel: string
  duration: number
  cashGoal: number
  customerPatience: number
  basePrice: number
  starThresholds: number[]
}
export type ProducerStation = {
  interaction: number[]
  depth: number
  draw: number[]
  sprite: number[]
  stockDisplay: { origin: number[]; step: number[]; size: number[] }
  interval: number
  capacity: number
}
export type SkinUpgrade = {
  id: string
  price: number
  spot: number[]
  effect: UpgradeEffect
  unlocks: string
}
export type GameSkin = {
  id: string
  spriteSheet: string
  shift: ShiftRules
  items: Record<string, SkinItem>
  orderDeck: SkinOrder[]
  producers: Record<string, ProducerStation>
  progression: { startingStation: string; startingStations: string[] }
  upgrades: SkinUpgrade[]
  palette: {
    strawberry: string
    mint: string
    sunshine: string
    waffle: string
    cream: string
    cocoa: string
  }
  spriteRects: number[][][]
  sprites: {
    player: { idle: number[]; walkLeft: number[]; walkRight: number[]; carry: number[] }
    customers: number[][]
    item: number[]
    coin: number[]
    heart: number[]
    sparkle: number[]
  }
  stations: Record<StationKey, {
    interaction: number[]
    depth: number
    draw: number[]
    sprite: number[]
  }>
}

export function stationPoint(skin: GameSkin, key: StationKey): Point {
  const [x, y] = skin.stations[key].interaction
  return { x, y }
}

export function producerPoint(skin: GameSkin, source: string): Point {
  const [x, y] = skin.producers[source].interaction
  return { x, y }
}

export function itemFor(skin: GameSkin, id: string): SkinItem {
  const item = skin.items[id]
  if (!item) throw new Error(`unknown item: ${id}`)
  return item
}

export function upgradeSpot(upgrade: SkinUpgrade): Point {
  const [x, y] = upgrade.spot
  return { x, y }
}

/** Upgrades purchase in declared order; the next one is the only visible spot. */
export function nextUpgrade(skin: GameSkin, owned: Record<string, number>): SkinUpgrade | undefined {
  return skin.upgrades.find(upgrade => !(owned[upgrade.id] > 0))
}

/** Sum of an effect kind across owned upgrades, so effects stay skin data. */
export function effectTotal(skin: GameSkin, owned: Record<string, number>, kind: UpgradeEffect['kind']): number {
  return skin.upgrades.reduce((total, upgrade) =>
    upgrade.effect.kind === kind && owned[upgrade.id] > 0 ? total + upgrade.effect.value : total, 0)
}
