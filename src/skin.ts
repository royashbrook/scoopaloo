import type { Point } from './engine'

export type StationKey = 'counter' | 'register'
export type UpgradeKind = 'walkSpeed' | 'trayCapacity' | 'churnTime' | 'customerPatience'
export type SkinOrder = { item: string; quantity: number }
export type SkinRecipe = {
  station: string
  inputs: Record<string, number>
  seconds: number
}
export type SkinItem = {
  label: string
  price: number
  icon: string
  color: string
  recipe?: SkinRecipe
}
export type CustomerOrder = SkinOrder & Pick<SkinItem, 'label' | 'icon' | 'color'> & { price: number }
export type ComboTier = { streak: number; bonus: number }
export type SkinDay = {
  id: string
  label: string
  challenge: string
  unlockBanner: string
  /** Stations granted when this day is entered (day index is persisted by SaveV1). */
  unlockStations?: string[]
  duration: number
  cashGoal: number
  starThresholds: number[]
  customerPatience: number
  spawnInterval: number
  orderDeck: SkinOrder[]
}
export type SkinScoreChase = {
  id: string
  label: string
  challenge: string
  duration: number
  cashGoal: number
  goalStep: number
  starGap: number
  customerPatience: number
  patienceStep: number
  minCustomerPatience: number
  spawnInterval: number
  spawnStep: number
  minSpawnInterval: number
  orderDeck: SkinOrder[]
}
export type ProducerStation = {
  item: string
  interaction: number[]
  depth: number
  draw: number[]
  sprite: number[]
  stockDisplay: { origin: number[]; step: number[]; size: number[] }
  interval: number
  capacity: number
}
export type PrepStation = {
  label: string
  interaction: number[]
  depth: number
  draw: number[]
  sprite: number[]
  outputDisplay: { origin: number[]; step: number[]; size: number[] }
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
export type SkinRoomImage = { image: string; draw: number[] }
export type SkinRoom = {
  horizon: number
  wall: string
  floor: string
  backdrop: SkinRoomImage
  floorProp: SkinRoomImage
}
export type GameSkin = {
  id: string
  spriteSheet: string
  room: SkinRoom
  comboTiers: ComboTier[]
  days: SkinDay[]
  scoreChase?: SkinScoreChase
  items: Record<string, SkinItem>
  producers: Record<string, ProducerStation>
  prepStations: Record<string, PrepStation>
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

export function prepPoint(skin: GameSkin, station: string): Point {
  const [x, y] = skin.prepStations[station].interaction
  return { x, y }
}

export function itemFor(skin: GameSkin, id: string): SkinItem {
  const item = skin.items[id]
  if (!item) throw new Error(`unknown item: ${id}`)
  return item
}
