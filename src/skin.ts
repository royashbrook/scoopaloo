import type { Point } from './engine'

export type StationKey = 'machine' | 'counter' | 'register'
export type UpgradeKind = 'walkSpeed' | 'trayCapacity' | 'churnTime' | 'customerPatience'
export type SkinOrder = { item: string; quantity: number }
export type SkinItem = {
  label: string
  price: number
  icon: string
  color: string
  recipe: { source: string }
}
export type CustomerOrder = SkinOrder & Pick<SkinItem, 'label' | 'icon' | 'color'> & { price: number }
export type SkinDay = {
  id: string
  label: string
  challenge: string
  unlockBanner: string
  duration: number
  cashGoal: number
  starThresholds: number[]
  customerPatience: number
  spawnInterval: number
  orderDeck: SkinOrder[]
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
  name: string
  kind: UpgradeKind
  unit: string
  levels: UpgradeLevel[]
}
export type UpgradeLevel = { price: number; effect: number }
export type GameSkin = {
  id: string
  spriteSheet: string
  days: SkinDay[]
  items: Record<string, SkinItem>
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
