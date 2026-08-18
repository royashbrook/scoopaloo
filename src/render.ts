import { byDepth, depthScale } from './depth'
import {
  directSourceForItem,
  guidedIntro,
  inventoryTotal,
  prepSeconds,
  secondCounterBuilt,
  WORLD,
  type Customer,
  type GameEvent,
  type GameState,
  type Point,
} from './engine'
import type { GameSkin } from './skin'
import { prepPoint, producerPoint } from './skin'
import type { Viewport } from './viewport'
import { worldToClient } from './viewport'

type Joystick = { active: boolean; origin: Point; current: Point }
type Drawable = { anchor: Point; draw: () => void }
type CounterVisual = {
  id: 'primary' | 'secondary'
  station: GameSkin['stations']['counter']
  serveTimer: number
}

const TAU = Math.PI * 2
const REDUCED_MOTION_SCALE = .28
const WALK_CYCLE_DISTANCE = 90
const WALK_SHEET_CELL = 362
const WALK_SHEET_COLUMNS = 4
const WALK_SHEET_FRAME_DISTANCE = WALK_CYCLE_DISTANCE / WALK_SHEET_COLUMNS
// Match the atlas idle sprite's rendered alpha bounds: 112.5×134, centered
// 0.7px right of the player anchor with its lowest opaque pixel at y + 8.5.
const WALK_SHEET_TARGET = { width: 112.5, height: 134, centerX: .7, baselineY: 8.5 } as const
// Main alpha>32 bounds for the fixed down/right/up rows. Up uses a negative
// local top because its hats begin in the gap after the side bodies; side
// crops stop before those pixels, while up keeps the complete connected art.
const WALK_SHEET_MAIN_BOUNDS = [
  [[167, 11, 347, 352], [109, 12, 287, 351], [67, 10, 244, 352], [17, 10, 195, 352]],
  [[164, 8, 336, 330], [104, 7, 278, 330], [66, 8, 241, 332], [13, 6, 187, 332]],
  [[162, -18, 334, 317], [105, -16, 275, 315], [67, -16, 238, 321], [14, -16, 186, 317]],
] as const

export function roomPropAnchor(draw: number[]): Point {
  const [x, y, width, height] = draw
  return { x: x + width / 2, y: y + height }
}

const PLAYER_EYES = { x: 17, y: -68, tone: '#fdcca9' }
const CUSTOMER_EYES = [
  { x: 15, y: -68, tone: '#fdcca9' },
  { x: -7, y: -68, tone: '#fdcca9' },
  { x: -18, y: -68, tone: '#fdcca9' },
  { x: -7, y: -68, tone: '#e79668' },
] as const

export const MOTION_TIMES = {
  // Browser fixture interval; player gait itself is selected from walkDistance.
  WALK_CYCLE: .48,
  PICKUP_APEX: .14,
  PICKUP_LAND: .28,
  DROP_APEX: .12,
  DROP_LAND: .24,
  BLINK_START: 4.18,
  BLINK_CLOSED: 4.26,
  BLINK_END: 4.34,
  BLINK_PERIOD: 4.6,
  MACHINE_APEX: .14,
  MACHINE_END: .28,
} as const

export const MOTION_DISTANCES = {
  WALK_CYCLE: WALK_CYCLE_DISTANCE,
  WALK_PLANT_A: 0,
  WALK_PASS_A: WALK_CYCLE_DISTANCE / 4,
  WALK_PLANT_B: WALK_CYCLE_DISTANCE / 2,
  WALK_PASS_B: WALK_CYCLE_DISTANCE * 3 / 4,
} as const

export type WalkPose = {
  stride: number
  x: number
  y: number
  lean: number
  scaleX: number
  scaleY: number
  shadowX: number
  shadowY: number
}

export type CarryPose = { x: number; y: number; rotation: number; amplitude: number }
export type TransferPose = Point & { scaleX: number; scaleY: number; rotation: number; progress: number }
export type MachinePose = { x: number; y: number; rotation: number; scaleY: number; pulse: number }
export type InteractionRingPose = { radiusX: number; radiusY: number; lineWidth: number; dashOffset: number }
export type GaitFrame = { sprite: number[]; flipX: boolean; beat: 0 | 1 }
export type WalkDirection = GameState['player']['direction']
export type WalkSheetFrame = { column: 0 | 1 | 2 | 3; row: 0 | 1 | 2; flipX: boolean }
export type WalkSheetPlacement = {
  sourceX: number
  sourceY: number
  sourceWidth: number
  sourceHeight: number
  destinationX: number
  destinationY: number
  destinationWidth: number
  destinationHeight: number
}
export type CustomerExitPose = { y: number; rotation: number; scaleX: number; scaleY: number }

const motionScale = (reducedMotion: boolean): number => reducedMotion ? REDUCED_MOTION_SCALE : 1
const limit = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value))
const cycle = (value: number, period: number): number => ((value % period) + period) % period / period

export function gaitFrame(
  walkDistance: number,
  facing: number,
  sprites: GameSkin['sprites']['player'],
): GaitFrame {
  const beat = (Math.floor(cycle(walkDistance, WALK_CYCLE_DISTANCE) * 2) % 2) as 0 | 1
  if (facing < 0) return beat === 0
    ? { sprite: sprites.walkLeft, flipX: false, beat }
    : { sprite: sprites.walkRight, flipX: true, beat }
  return beat === 0
    ? { sprite: sprites.walkRight, flipX: false, beat }
    : { sprite: sprites.walkLeft, flipX: true, beat }
}

export function walkSheetFrame(walkDistance: number, direction: WalkDirection): WalkSheetFrame {
  const column = ((Math.floor(walkDistance / WALK_SHEET_FRAME_DISTANCE) % WALK_SHEET_COLUMNS)
    + WALK_SHEET_COLUMNS) % WALK_SHEET_COLUMNS as 0 | 1 | 2 | 3
  if (direction === 'down') return { column, row: 0, flipX: false }
  if (direction === 'up') return { column, row: 2, flipX: false }
  return { column, row: 1, flipX: direction === 'left' }
}

export function walkSheetPlacement(frame: WalkSheetFrame, centerX: number, groundY: number): WalkSheetPlacement {
  const [left, top, right, bottom] = WALK_SHEET_MAIN_BOUNDS[frame.row][frame.column]
  return {
    sourceX: frame.column * WALK_SHEET_CELL + left,
    sourceY: frame.row * WALK_SHEET_CELL + top,
    sourceWidth: right - left + 1,
    sourceHeight: bottom - top + 1,
    destinationX: centerX + WALK_SHEET_TARGET.centerX - WALK_SHEET_TARGET.width / 2,
    destinationY: groundY + WALK_SHEET_TARGET.baselineY - WALK_SHEET_TARGET.height,
    destinationWidth: WALK_SHEET_TARGET.width,
    destinationHeight: WALK_SHEET_TARGET.height,
  }
}

export function introStationAlpha(active: boolean, focused: boolean, prep = false): number {
  if (!active || focused) return 1
  return prep ? .12 : .16
}

export function sourceVisualItem(state: GameState, sourceId: string): string {
  return state.sources[sourceId]?.item
    ?? state.rules.intro?.directSources.find(source => source.source === sourceId)?.item
    ?? state.skin.producers[sourceId].item
}

export function lockedProducerLabel(state: GameState, sourceId: string): string {
  const introSource = state.rules.intro?.directSources.find(source => source.source === sourceId)
  return introSource && introSource.unlockAfterServes > state.shift.served
    ? `${introSource.unlockAfterServes - state.shift.served} MORE`
    : 'DAY 2'
}

export function customerExitPose(exit: number, served: boolean, reducedMotion = false): CustomerExitPose {
  const scale = motionScale(reducedMotion)
  const progress = limit(exit / .52)
  const hop = served ? Math.sin(Math.PI * progress) : 0
  const settle = Math.sin(TAU * progress)
  return {
    y: (served ? -18 * hop : 4 * progress) * scale,
    rotation: (served ? .045 * settle : .025 * progress) * scale,
    scaleX: 1 + (served ? .04 * hop : -.015 * progress) * scale,
    scaleY: 1 + (served ? -.035 * hop : -.02 * progress) * scale,
  }
}

export function interactionRingPose(
  time: number,
  distance: number,
  contactAge?: number,
  reducedMotion = false,
): InteractionRingPose {
  const t = limit((120 - distance) / (120 - 68))
  const focus = t * t * (3 - 2 * t)
  const scale = motionScale(reducedMotion)
  const age = contactAge === undefined ? MOTION_TIMES.DROP_LAND : contactAge
  const contact = age >= 0 && age < MOTION_TIMES.DROP_LAND
    ? Math.sin(Math.PI * age / MOTION_TIMES.DROP_LAND)
    : 0
  const radiusX = 67 - 4 * focus * scale
  const radiusY = 29 - 2 * focus * scale
  return {
    radiusX: radiusX * (1 + .08 * contact * scale),
    radiusY: radiusY * (1 - .1 * contact * scale),
    lineWidth: 4 + 2 * focus + 2 * contact,
    dashOffset: reducedMotion ? 0 : -time * 18,
  }
}

type Rect = { left: number; top: number; right: number; bottom: number }

function projectedRect(draw: readonly number[], anchor: Point, scale: number): Rect {
  const [x, y, width, height] = draw
  return {
    left: anchor.x + (x - anchor.x) * scale,
    top: anchor.y + (y - anchor.y) * scale,
    right: anchor.x + (x + width - anchor.x) * scale,
    bottom: anchor.y + (y + height - anchor.y) * scale,
  }
}

export function stationOcclusionAlpha(
  player: Pick<GameState['player'], 'x' | 'y'>,
  stationDraw: readonly number[],
  stationAnchor: Point,
): number {
  if (stationAnchor.y <= player.y) return 1
  const playerRect = projectedRect(
    [player.x - 48, player.y - 122, 96, 132],
    player,
    depthScale(player.y),
  )
  const stationRect = projectedRect(stationDraw, stationAnchor, depthScale(stationAnchor.y))
  const overlapWidth = Math.max(0, Math.min(playerRect.right, stationRect.right) - Math.max(playerRect.left, stationRect.left))
  const overlapHeight = Math.max(0, Math.min(playerRect.bottom, stationRect.bottom) - Math.max(playerRect.top, stationRect.top))
  const playerArea = (playerRect.right - playerRect.left) * (playerRect.bottom - playerRect.top)
  const coverage = overlapWidth * overlapHeight / playerArea
  return 1 - .52 * limit(coverage / .2)
}

export function visibleCounters(state: GameState): CounterVisual[] {
  const counters: CounterVisual[] = [{
    id: 'primary',
    station: state.skin.stations.counter,
    serveTimer: state.counter.serveTimer,
  }]
  const expansion = state.skin.counterExpansion
  if (expansion && secondCounterBuilt(state)) counters.push({
    id: 'secondary',
    station: expansion.station,
    serveTimer: state.secondaryCounter.serveTimer,
  })
  return counters
}

export function visibleCounterRunner(state: GameState): GameSkin['counterRunner'] | null {
  return state.skin.counterRunner && secondCounterBuilt(state) ? state.skin.counterRunner : null
}

export function visibleHelper(state: GameState): GameSkin['helper'] | null {
  const reachedHelperDay = state.rules.kind === 'score-chase' || state.rules.level >= 3
  return reachedHelperDay && !guidedIntro(state) ? state.skin.helper ?? null : null
}

export function walkPose(walkDistance: number, moving: boolean, facing: number, reducedMotion = false): WalkPose {
  if (!moving) return {
    stride: 0,
    x: 0,
    y: 0,
    lean: 0,
    scaleX: 1,
    scaleY: 1,
    shadowX: 43,
    shadowY: 13,
  }
  const scale = motionScale(reducedMotion)
  const phase = cycle(walkDistance, WALK_CYCLE_DISTANCE)
  const stride = Math.cos(TAU * phase)
  const lift = 1 - Math.abs(stride)
  const stretch = (2 * lift - 1) * .012 * scale
  return {
    stride,
    x: 1.5 * stride * facing * scale,
    y: lift === 0 ? 0 : -4 * lift * scale,
    lean: .03 * stride * facing * scale,
    scaleX: 1 - stretch,
    scaleY: 1 + stretch,
    shadowX: 43 + 3 * lift * scale,
    shadowY: 13 - 2 * lift * scale,
  }
}

export function carryPose(walkDistance: number, energy: number, load: number, facing: number, reducedMotion = false): CarryPose {
  const scale = motionScale(reducedMotion)
  const amplitude = limit(energy) * (1.2 + .9 * Math.min(Math.max(0, load), 5)) * scale
  const phase = cycle(walkDistance, WALK_CYCLE_DISTANCE)
  const wave = Math.sin(TAU * phase)
  return {
    x: -facing * wave * amplitude,
    y: .35 * Math.abs(Math.cos(TAU * phase)) * amplitude,
    rotation: -.012 * wave * amplitude,
    amplitude,
  }
}

export function transferPose(
  kind: 'pickup' | 'drop',
  age: number,
  from: Point,
  to: Point,
  reducedMotion = false,
): TransferPose {
  const duration = kind === 'pickup' ? MOTION_TIMES.PICKUP_LAND : MOTION_TIMES.DROP_LAND
  const progress = limit(age / duration)
  const eased = 1 - (1 - progress) ** 3
  const scale = motionScale(reducedMotion)
  const stretch = .18 * Math.sin(Math.PI * progress) * scale
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased
      - Math.sin(Math.PI * progress) * (kind === 'pickup' ? 18 : 38) * scale,
    scaleX: 1 - stretch,
    scaleY: 1 + stretch,
    rotation: (kind === 'pickup' ? -1 : 1) * .1 * Math.sin(Math.PI * progress) * scale,
    progress,
  }
}

export function blinkPose(time: number, phaseOffset = 0): number {
  const local = ((time + phaseOffset) % MOTION_TIMES.BLINK_PERIOD + MOTION_TIMES.BLINK_PERIOD)
    % MOTION_TIMES.BLINK_PERIOD
  if (local < MOTION_TIMES.BLINK_START || local > MOTION_TIMES.BLINK_END) return 0
  return Math.sin(Math.PI * (local - MOTION_TIMES.BLINK_START)
    / (MOTION_TIMES.BLINK_END - MOTION_TIMES.BLINK_START))
}

export function machinePose(eventAge?: number, reducedMotion = false): MachinePose {
  if (eventAge === undefined || eventAge < 0 || eventAge > MOTION_TIMES.MACHINE_END) {
    return { x: 0, y: 0, rotation: 0, scaleY: 1, pulse: 0 }
  }
  const scale = motionScale(reducedMotion)
  const pulse = Math.sin(Math.PI * eventAge / MOTION_TIMES.MACHINE_END)
  const wave = Math.sin(TAU * eventAge / MOTION_TIMES.MACHINE_END)
  return {
    x: 2.5 * wave * scale,
    y: -2 * pulse * scale,
    rotation: .018 * wave * scale,
    scaleY: 1 + .02 * pulse * scale,
    pulse,
  }
}

export function latestMachineEventAge(
  events: readonly GameEvent[],
  sourceId: string,
): number | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if ((event.kind === 'pour' || event.kind === 'pickup') && event.source === sourceId) {
      return event.age
    }
  }
  return undefined
}

export class Renderer {
  readonly context: CanvasRenderingContext2D
  readonly atlas = new Image()
  readonly itemImages = new Map<string, HTMLImageElement>()
  readonly roomBackdrop = new Image()
  readonly roomFloorProp = new Image()
  readonly helperImage?: HTMLImageElement
  readonly playerWalkImage?: HTMLImageElement
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(readonly canvas: HTMLCanvasElement, readonly skin: GameSkin) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas unavailable')
    this.context = context
    this.atlas.src = skin.spriteSheet
    this.roomBackdrop.src = skin.room.backdrop.image
    this.roomFloorProp.src = skin.room.floorProp.image
    if (skin.playerWalkSheet) {
      this.playerWalkImage = new Image()
      this.playerWalkImage.src = skin.playerWalkSheet
    }
    if (skin.helper) {
      this.helperImage = new Image()
      this.helperImage.src = skin.helper.image
    }
    for (const [id, item] of Object.entries(skin.items)) {
      const image = new Image()
      image.src = item.icon
      this.itemImages.set(id, image)
    }
  }

  assetsReady(): boolean {
    return this.atlas.complete && this.atlas.naturalWidth > 0
      && this.roomBackdrop.complete && this.roomBackdrop.naturalWidth > 0
      && this.roomFloorProp.complete && this.roomFloorProp.naturalWidth > 0
      && (!this.helperImage || this.helperImage.complete && this.helperImage.naturalWidth > 0)
      && (!this.playerWalkImage || this.playerWalkImage.complete && this.playerWalkImage.naturalWidth > 0)
      && [...this.itemImages.values()].every(image => image.complete && image.naturalWidth > 0)
  }

  draw(state: GameState, joystick: Joystick, view: Viewport): void {
    const ctx = this.context
    // clear in backing pixels, then draw the whole frame in world units through
    // the shared viewport: one uniform scale, extra axis exposes more world (#13)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    const k = view.dpr * view.scale
    ctx.setTransform(k, 0, 0, k, -view.originX * k, -view.originY * k)
    this.drawRoom(view)
    this.drawAnnex(state)

    // every drawable is one grounded unit (#14): sprite, shadow, stock, rings all
    // scale together around the unit's ground-contact anchor. byDepth is the ONLY
    // ordering rule; ties keep this list's order (room prop, stations, creatures).
    const counters = visibleCounters(state)
    const counterRunner = visibleCounterRunner(state)
    const helper = visibleHelper(state)
    const intro = guidedIntro(state) && Boolean(state.rules.intro?.directSources.length)
    const frontItem = state.customers.find(customer => !customer.served && !customer.missed)?.order.item
    const directSource = frontItem ? directSourceForItem(state, frontItem) : undefined
    const things: (Drawable & { anchor: Point })[] = [
      {
        anchor: roomPropAnchor(this.skin.room.floorProp.draw),
        draw: () => this.drawRoomFloorProp(),
      },
      ...Object.entries(this.skin.producers).map(([source, producer]) => ({
        anchor: { x: producerPoint(this.skin, source).x, y: producer.depth },
        draw: () => this.drawProducer(state, source, introStationAlpha(intro, source === directSource)),
      })),
      ...Object.entries(this.skin.prepStations).map(([station, prep]) => ({
        anchor: { x: prepPoint(this.skin, station).x, y: prep.depth },
        draw: () => this.drawPrepStation(state, station, introStationAlpha(intro, false, true)),
      })),
      ...counters.map(counter => ({
        anchor: { x: counter.station.interaction[0], y: counter.station.depth },
        draw: () => this.drawCounter(state, counter, counter.id === 'primary'),
      })),
      ...(helper
        ? [{ anchor: roomPropAnchor(helper.draw), draw: () => this.drawHelper(state) }]
        : []),
      ...(counterRunner && !intro ? [{ anchor: roomPropAnchor(counterRunner.draw), draw: () => this.drawCounterRunner(state) }] : []),
      ...state.customers.map(customer => ({
        anchor: { x: customer.x, y: customer.y },
        draw: () => this.drawCustomer(customer, state.time),
      })),
      { anchor: { x: state.player.x, y: state.player.y }, draw: () => this.drawPlayer(state) },
    ]
    things.sort(byDepth).forEach(item => this.grounded(item.anchor, item.draw))
    state.flyingCoins.forEach(coin => this.grounded({ x: coin.x, y: coin.y }, () => this.drawCoin(coin.x, coin.y, coin.age)))
    state.events.forEach(event => this.grounded({ x: event.x, y: event.y }, () => this.drawEvent(state, event)))
    state.events.filter(event => event.kind === 'pay' && event.amount).forEach(event =>
      this.drawPayAmount(event.x, event.y, event.age, event.amount ?? 0, event.tip ?? 0, event.combo ?? 0, view))
    state.events.filter(event => event.kind === 'combo-break').forEach(event =>
      this.drawComboBreak(event.x, event.y, event.age, event.streak ?? 0, view))
    if (joystick.active) this.drawJoystick(joystick)
  }

  // translate to the ground anchor, scale by its depth, translate back, draw the
  // whole unit. gameplay coordinates never see this transform.
  private grounded(anchor: Point, draw: () => void): void {
    const ctx = this.context
    const scale = depthScale(anchor.y)
    ctx.save()
    ctx.translate(anchor.x, anchor.y)
    ctx.scale(scale, scale)
    ctx.translate(-anchor.x, -anchor.y)
    draw()
    ctx.restore()
  }

  private drawRoom(view: Viewport): void {
    const ctx = this.context
    // paint the FULL visible world rect: portrait shows more wall above and more
    // floor below, wide screens show the room continuing left and right. no bars.
    const left = view.originX
    const top = view.originY
    const bottom = view.originY + view.viewHeight
    const { room } = this.skin
    ctx.fillStyle = room.wall
    ctx.fillRect(left, top, view.viewWidth, view.viewHeight)
    ctx.fillStyle = room.floor
    ctx.fillRect(left, room.horizon, view.viewWidth, bottom - room.horizon)
    if (this.roomBackdrop.complete && this.roomBackdrop.naturalWidth > 0) {
      ctx.drawImage(this.roomBackdrop, ...room.backdrop.draw as [number, number, number, number])
    }
  }

  private drawRoomFloorProp(): void {
    if (!this.roomFloorProp.complete || !this.roomFloorProp.naturalWidth) return
    const draw = this.skin.room.floorProp.draw as [number, number, number, number]
    const anchor = roomPropAnchor(draw)
    this.shadow(anchor.x, anchor.y - 2, 30, 8)
    this.context.drawImage(this.roomFloorProp, ...draw)
  }

  private drawAnnex(state: GameState): void {
    const annex = this.skin.room.annex
    if (!annex) return
    const [x, y, width, height] = annex.doorway
    const unlocked = state.save.unlockedStations.includes(annex.unlockStation)
    const ctx = this.context
    ctx.save()
    if (unlocked) {
      ctx.strokeStyle = this.skin.palette.cocoa
      ctx.globalAlpha = .24
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(x + width / 2, y)
      ctx.lineTo(x + width / 2, y + 64)
      ctx.moveTo(x + width / 2, y + height - 64)
      ctx.lineTo(x + width / 2, y + height)
      ctx.stroke()
      ctx.restore()
      return
    }
    ctx.fillStyle = this.skin.palette.waffle
    ctx.strokeStyle = this.skin.palette.cocoa
    ctx.lineWidth = 5
    rounded(ctx, x, y, width, height, width / 2)
    ctx.fill()
    ctx.stroke()
    ctx.globalAlpha = .38
    ctx.lineWidth = 3
    for (let at = y + 24; at < y + height - 12; at += 34) {
      ctx.beginPath()
      ctx.moveTo(x + 3, at)
      ctx.lineTo(x + width - 3, at + 16)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawHelper(state: GameState): void {
    const helper = this.skin.helper
    if (!helper || !this.helperImage?.complete || !this.helperImage.naturalWidth) return
    const ctx = this.context
    const enabled = (state.save.upgrades[helper.upgradeId] ?? 0) > 0
    const anchor = roomPropAnchor(helper.draw)
    const [x, y, width, height] = helper.draw

    this.shadow(anchor.x, anchor.y + 1, 25, 8)
    ctx.save()
    ctx.globalAlpha = enabled ? 1 : .45
    ctx.drawImage(this.helperImage, x, y, width, height)
    ctx.restore()

    const [pillX, pillY, pillWidth, pillHeight] = helper.status
    rounded(ctx, pillX, pillY, pillWidth, pillHeight, 15)
    ctx.fillStyle = enabled && state.helper.remaining <= 0 ? this.skin.palette.mint : this.skin.palette.cream
    ctx.fill()
    ctx.strokeStyle = this.skin.palette.cocoa
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = this.skin.palette.cocoa
    ctx.font = '900 21px ui-rounded, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const wait = Math.ceil(Math.max(0, state.helper.remaining))
    const status = !enabled ? 'OFF' : wait ? `${wait}s` : 'READY'
    ctx.fillText(`${helper.name} · ${status}`, pillX + pillWidth / 2, pillY + pillHeight / 2 + 1)
  }

  private drawCounterRunner(state: GameState): void {
    const runner = visibleCounterRunner(state)
    if (!runner) return
    const ctx = this.context
    const enabled = (state.save.upgrades[runner.upgradeId] ?? 0) > 0
    const [x, y, width, height] = runner.draw
    const [column, row] = runner.sprite
    const anchor = roomPropAnchor(runner.draw)

    this.shadow(anchor.x, anchor.y + 1, 25, 8)
    ctx.save()
    ctx.globalAlpha = enabled ? 1 : .45
    this.sprite(column, row, x, y, width, height)
    ctx.restore()

    const [pillX, pillY, pillWidth, pillHeight] = runner.status
    rounded(ctx, pillX, pillY, pillWidth, pillHeight, 15)
    ctx.fillStyle = enabled && state.counterRunner.remaining <= 0 ? this.skin.palette.mint : this.skin.palette.cream
    ctx.fill()
    ctx.strokeStyle = this.skin.palette.cocoa
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = this.skin.palette.cocoa
    ctx.font = '900 21px ui-rounded, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const wait = Math.ceil(Math.max(0, state.counterRunner.remaining))
    ctx.fillText(`${runner.name} · ${!enabled ? 'OFF' : wait ? `${wait}s` : 'READY'}`, pillX + pillWidth / 2, pillY + pillHeight / 2 + 1)
  }

  private drawProducer(state: GameState, sourceId: string, emphasis = 1): void {
    const producer = this.skin.producers[sourceId]
    const source = state.sources[sourceId]
    const item = sourceVisualItem(state, sourceId)
    const [x, y, width, height] = producer.draw
    const [column, row] = producer.sprite
    const point = producerPoint(this.skin, sourceId)
    const artAlpha = stationOcclusionAlpha(state.player, producer.draw, { x: point.x, y: producer.depth })
    if (!source) {
      const ctx = this.context
      ctx.save()
      ctx.globalAlpha = .35 * artAlpha * emphasis
      this.shadow(point.x, point.y + 6, width * .42, 22)
      this.sprite(column, row, x, y, width, height)
      ctx.restore()
      const label = lockedProducerLabel(state, sourceId)
      this.drawProducerPlaque(point, item, true, label === 'DAY 2' ? emphasis : 1, label)
      return
    }

    const pose = machinePose(latestMachineEventAge(state.events, sourceId), this.reducedMotion)
    const ctx = this.context
    ctx.save()
    ctx.globalAlpha = artAlpha * emphasis
    this.shadow(point.x, point.y + 6, width * .42 * (1 + pose.pulse * .03), 22 * (1 - pose.pulse * .08))
    ctx.restore()
    ctx.save()
    ctx.translate(point.x + pose.x, point.y + pose.y)
    ctx.rotate(pose.rotation)
    ctx.scale(1, pose.scaleY)
    ctx.translate(-point.x, -point.y)
    ctx.save()
    ctx.globalAlpha = artAlpha * emphasis
    this.sprite(column, row, x, y, width, height)
    ctx.restore()
    ctx.globalAlpha = emphasis
    if (pose.pulse > 0) {
      ctx.strokeStyle = this.skin.palette.strawberry
      ctx.lineWidth = 6
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.ellipse(point.x, point.y - 47 + i * 7, 17 - i * 3, 5, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    const { origin, step, size } = producer.stockDisplay
    for (let i = 0; i < source.stock; i++) {
      this.drawItem(item, origin[0] + step[0] * i, origin[1] + step[1] * i, size[0], size[1])
    }
    ctx.restore()
    this.drawProducerPlaque(point, item, false, emphasis)
    // Keep the nearest row's full ring on short tablet canvases while leaving
    // its interaction point unchanged.
    if (emphasis === 1) this.pickupRing(
      point.x,
      Math.min(point.y + 35, WORLD.height - 40),
      state,
      point,
      this.interactionAge(state, event => event.kind === 'pickup' && event.source === sourceId),
    )
  }

  private drawProducerPlaque(point: Point, item: string, locked: boolean, alpha = 1, lockedLabel = 'DAY 2'): void {
    const ctx = this.context
    ctx.save()
    ctx.globalAlpha = alpha
    const top = point.y - (locked ? 142 : 134)
    const height = locked ? 82 : 66
    ctx.fillStyle = this.skin.palette.cream
    ctx.strokeStyle = this.skin.palette.cocoa
    ctx.lineWidth = 3
    rounded(ctx, point.x - 32, top, 64, height, 14); ctx.fill(); ctx.stroke()
    if (locked) {
      this.drawItem(item, point.x - 20, top + 3, 40, 44)
      ctx.fillStyle = this.skin.palette.cocoa
      ctx.font = '900 18px ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(lockedLabel, point.x, top + 65)
      ctx.restore()
      return
    }
    this.drawItem(item, point.x - 24, top + 5, 48, 56)
    ctx.restore()
  }

  private drawCounter(state: GameState, visual: CounterVisual, showSharedStock: boolean): void {
    const { station, serveTimer } = visual
    const [x, y, width, height] = station.draw
    const [column, row] = station.sprite
    const counter = { x: station.interaction[0], y: station.interaction[1] }
    const artAlpha = stationOcclusionAlpha(state.player, station.draw, { x: counter.x, y: station.depth })
    const ctx = this.context
    ctx.save()
    ctx.globalAlpha = artAlpha
    this.shadow(counter.x, counter.y + 8, 65, 18)
    this.sprite(column, row, x, y, width, height)
    ctx.restore()
    const airborneDrop = this.airborneTransfer(state, 'drop')
    const stock = withoutOne(inventoryItems(state.counter.items), airborneDrop?.item)
    if (showSharedStock && stock.length > 0) {
      ctx.fillStyle = this.skin.palette.cream
      ctx.strokeStyle = this.skin.palette.cocoa
      ctx.lineWidth = 4
      rounded(ctx, counter.x - 88, counter.y - 40, 82, 27, 12); ctx.fill(); ctx.stroke()
      stock.slice(0, 4).forEach((item, index) =>
        this.drawItem(item, counter.x - 82 + index * 20, counter.y - 71, 29, 38))
    }
    if (serveTimer > 0) {
      const ctx = this.context
      ctx.strokeStyle = this.skin.palette.mint
      ctx.lineWidth = 8
      ctx.beginPath(); ctx.arc(counter.x, counter.y - 85, 24, -.5 * Math.PI, (-.5 + serveTimer / .7 * 2) * Math.PI); ctx.stroke()
    }
    if (visual.id === 'secondary') this.pickupRing(
      counter.x,
      counter.y + 35,
      state,
      counter,
      this.interactionAge(state, event => event.kind === 'drop'
        && Math.hypot(event.x - counter.x, event.y - counter.y) < 1),
    )
  }

  private drawPrepStation(state: GameState, stationId: string, emphasis = 1): void {
    const station = this.skin.prepStations[stationId]
    const prep = state.prepStations[stationId]
    const [x, y, width, height] = station.draw
    const [column, row] = station.sprite
    const point = prepPoint(this.skin, stationId)
    const artAlpha = stationOcclusionAlpha(state.player, station.draw, { x: point.x, y: station.depth })
    const ctx = this.context
    ctx.save()
    ctx.globalAlpha = artAlpha * emphasis
    this.shadow(point.x, point.y + 8, width * .42, 20)
    this.sprite(column, row, x, y, width, height)
    ctx.restore()
    ctx.save()
    ctx.globalAlpha = emphasis
    const { origin, step, size } = station.outputDisplay
    inventoryItems(prep.outputs).slice(0, station.capacity).forEach((item, index) =>
      this.drawItem(item, origin[0] + step[0] * index, origin[1] + step[1] * index, size[0], size[1]))
    if (prep.job) {
      const progress = 1 - prep.job.remaining / prepSeconds(state, prep.job.item)
      ctx.strokeStyle = this.skin.palette.mint
      ctx.lineWidth = 9
      ctx.beginPath()
      ctx.arc(point.x, point.y - 92, 31, -.5 * Math.PI, (-.5 + Math.max(0, Math.min(1, progress)) * 2) * Math.PI)
      ctx.stroke()
      this.drawItem(prep.job.item, point.x - 18, point.y - 115, 36, 45)
    }
    if (emphasis === 1) this.pickupRing(
      point.x,
      point.y + 34,
      state,
      point,
      this.interactionAge(state, event =>
        (event.kind === 'pickup' || event.kind === 'prep-start')
        && event.station === stationId && event.source !== 'helper'),
    )
    ctx.restore()
  }

  private drawPlayer(state: GameState): void {
    const player = state.player
    const walk = walkPose(player.walkDistance, player.moving, player.facing, this.reducedMotion)
    const airbornePickup = this.airborneTransfer(state, 'pickup')
    const airborneDrop = this.airborneTransfer(state, 'drop')
    const carried = withoutOne(inventoryItems(player.trayItems), airbornePickup?.item)
    const gait = gaitFrame(player.walkDistance, player.facing, this.skin.sprites.player)
    const [column, row] = player.moving ? gait.sprite : this.skin.sprites.player.idle
    this.shadow(player.x, player.y + 5, walk.shadowX, walk.shadowY)
    if (player.moving) this.drawFootPatter(player, walk.stride)

    const ctx = this.context
    ctx.save()
    ctx.translate(player.x, player.y)
    ctx.rotate(walk.lean)
    ctx.scale(walk.scaleX, walk.scaleY)
    ctx.translate(-player.x, -player.y)
    if (player.moving && this.playerWalkImage?.complete && this.playerWalkImage.naturalWidth > 0) {
      this.walkSheetSprite(
        walkSheetFrame(player.walkDistance, player.direction),
        player.x + walk.x,
        player.y + walk.y,
      )
    } else {
      this.sprite(column, row, player.x - 66 + walk.x, player.y - 130 + walk.y, 132, 142, player.moving && gait.flipX)
    }
    const blink = player.moving ? 0 : blinkPose(state.time)
    if (blink > 0) this.drawEyelids(
      player.x + walk.x + PLAYER_EYES.x,
      player.y + walk.y + PLAYER_EYES.y,
      blink,
      PLAYER_EYES.tone,
    )
    ctx.restore()

    const showTray = carried.length > 0 || Boolean(airbornePickup || airborneDrop)
    if (showTray) {
      const load = Math.max(1, player.tray + (airborneDrop ? 1 : 0))
      const carry = carryPose(player.walkDistance, player.trayWobble, load, player.facing, this.reducedMotion)
      const dip = this.trayDip(state)
      const itemWidth = Math.min(34, 82 / carried.length)
      const trayWidth = Math.max(58, carried.length * itemWidth + 12)
      const trayX = player.x + walk.x + carry.x
      const trayY = player.y - 25 + walk.y + carry.y + dip
      ctx.save()
      ctx.translate(trayX, trayY)
      ctx.rotate(carry.rotation)
      carried.slice(0, 5).forEach((item, index) => {
        const start = -carried.length * itemWidth / 2
        this.drawItem(item, start + index * itemWidth, -36, itemWidth, 40)
      })
      ctx.fillStyle = this.skin.palette.cocoa
      ctx.strokeStyle = this.skin.palette.cocoa
      ctx.lineWidth = 2
      rounded(ctx, -trayWidth / 2, 0, trayWidth, 8, 4); ctx.fill(); ctx.stroke()
      ctx.restore()
    }
  }

  private drawCustomer(customer: Customer, time: number): void {
    const { look, x, y: groundY, served, missed } = customer
    const bob = Math.sin(time * 4 + look) * (this.reducedMotion ? .84 : 3)
    const exit = customerExitPose(customer.exit, served, this.reducedMotion)
    const y = groundY + exit.y
    this.shadow(x, groundY + 4, 40 * exit.scaleX, 12 / exit.scaleY)
    const [customerColumn, customerRow] = this.skin.sprites.customers[look % this.skin.sprites.customers.length]
    const [heartColumn, heartRow] = this.skin.sprites.heart
    const ctx = this.context
    ctx.save()
    ctx.translate(x, groundY)
    ctx.rotate(exit.rotation)
    ctx.scale(exit.scaleX, exit.scaleY)
    ctx.translate(-x, -groundY)
    this.sprite(customerColumn, customerRow, x - 58, y - 122 + bob, 116, 132)
    const blink = blinkPose(time, customer.id * .73)
    const eyes = CUSTOMER_EYES[look % CUSTOMER_EYES.length]
    if (blink > 0) this.drawEyelids(x + eyes.x, y + eyes.y + bob, blink, eyes.tone)
    if (served) this.sprite(heartColumn, heartRow, x - 18, y - 160 + bob, 36, 36)
    ctx.restore()
    if (missed) {
      ctx.save()
      ctx.fillStyle = this.skin.palette.strawberry
      ctx.strokeStyle = this.skin.palette.cocoa
      ctx.lineWidth = 4
      ctx.beginPath(); ctx.arc(x, y - 144 + bob, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.fillStyle = this.skin.palette.cream
      ctx.font = '900 30px system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('!', x, y - 143 + bob)
      ctx.restore()
    }
  }

  private drawCoin(x: number, y: number, age: number): void {
    const pulse = this.reducedMotion ? 1 : .9 + Math.sin(age * 12) * .1
    const [column, row] = this.skin.sprites.coin
    this.sprite(column, row, x - 15 * pulse, y - 15 * pulse, 30 * pulse, 30 * pulse)
  }

  private airborneTransfer(state: GameState, kind: 'pickup' | 'drop'): GameEvent | undefined {
    const duration = kind === 'pickup' ? MOTION_TIMES.PICKUP_LAND : MOTION_TIMES.DROP_LAND
    for (let index = state.events.length - 1; index >= 0; index--) {
      const event = state.events[index]
      const age = state.time - event.createdAt
      if (event.kind === kind && event.item && age >= 0 && age < duration) return event
    }
    return undefined
  }

  private trayDip(state: GameState): number {
    const event = this.airborneTransfer(state, 'drop') ?? this.airborneTransfer(state, 'pickup')
    if (!event || (event.kind !== 'pickup' && event.kind !== 'drop')) return 0
    const age = Math.max(0, state.time - event.createdAt)
    const duration = event.kind === 'pickup' ? MOTION_TIMES.PICKUP_LAND : MOTION_TIMES.DROP_LAND
    const amount = event.kind === 'pickup' ? 5 : 7
    return Math.sin(Math.PI * limit(age / duration)) * amount * motionScale(this.reducedMotion)
  }

  private drawFootPatter(player: GameState['player'], stride: number): void {
    const ctx = this.context
    const lead = stride >= 0 ? 1 : -1
    const strength = .18 + Math.abs(stride) * .22
    ctx.save()
    ctx.fillStyle = this.skin.palette.cocoa
    ctx.globalAlpha = strength
    ctx.beginPath()
    ctx.ellipse(player.x + lead * player.facing * 13, player.y + 1, 8, 2.4, 0, 0, TAU)
    ctx.fill()
    ctx.globalAlpha = strength * .45
    ctx.beginPath()
    ctx.ellipse(player.x - lead * player.facing * 10, player.y + 2, 6, 1.8, 0, 0, TAU)
    ctx.fill()
    ctx.restore()
  }

  private drawEyelids(x: number, y: number, amount: number, tone: string): void {
    const ctx = this.context
    ctx.save()
    ctx.globalAlpha = limit(amount)
    ctx.fillStyle = tone
    for (const offset of [-14, 14]) {
      ctx.beginPath()
      ctx.ellipse(x + offset, y, 8, 10, 0, 0, TAU)
      ctx.fill()
    }
    ctx.strokeStyle = this.skin.palette.cocoa
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    for (const offset of [-14, 14]) {
      ctx.beginPath()
      ctx.moveTo(x + offset - 5, y)
      ctx.quadraticCurveTo(x + offset, y + 3, x + offset + 5, y)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawEvent(state: GameState, event: GameEvent): void {
    const ctx = this.context
    const { kind, x, y } = event
    if (kind === 'prep-start' && event.source === 'helper' && this.skin.helper) {
      const age = Math.max(0, state.time - event.createdAt)
      if (age >= MOTION_TIMES.DROP_LAND) return
      const recipe = event.item ? this.skin.items[event.item]?.recipe : undefined
      const target = prepPoint(this.skin, event.station ?? recipe?.station ?? this.skin.helper.prepStation)
      const inputs = Object.keys(recipe?.inputs ?? {})
      inputs.forEach((item, index) => {
        const source = Object.keys(state.sources).find(id => state.sources[id].item === item)
        if (!source) return
        const origin = producerPoint(this.skin, source)
        const offset = (index - (inputs.length - 1) / 2) * 24
        const pose = transferPose('drop', age,
          { x: origin.x, y: origin.y - 42 }, { x: target.x + offset, y: target.y - 54 }, this.reducedMotion)
        ctx.save()
        ctx.translate(pose.x, pose.y)
        ctx.rotate(pose.rotation)
        ctx.scale(pose.scaleX, pose.scaleY)
        this.drawItem(item, -15, -18, 30, 36)
        ctx.restore()
      })
      return
    }
    if ((kind === 'pickup' || kind === 'drop') && event.item) {
      const age = Math.max(0, state.time - event.createdAt)
      const duration = kind === 'pickup' ? MOTION_TIMES.PICKUP_LAND : MOTION_TIMES.DROP_LAND
      if (age >= duration) return
      const origin = event.from ?? event
      const from = { x: origin.x, y: origin.y - 41 }
      let to = { x, y: y - 52 }
      if (kind === 'pickup') {
        const player = state.player
        const walk = walkPose(player.walkDistance, player.moving, player.facing, this.reducedMotion)
        const carry = carryPose(player.walkDistance, player.trayWobble, Math.max(1, player.tray), player.facing, this.reducedMotion)
        to = {
          x: player.x + walk.x + carry.x,
          y: player.y - 41 + walk.y + carry.y + this.trayDip(state),
        }
      }
      const pose = transferPose(kind, age, from, to, this.reducedMotion)
      ctx.save()
      ctx.translate(pose.x, pose.y)
      ctx.rotate(pose.rotation)
      ctx.scale(pose.scaleX, pose.scaleY)
      this.drawItem(event.item, -17, -20, 34, 40)
      ctx.restore()
      return
    }

    const t = Math.min(1, event.age / .75)
    ctx.save()
    ctx.globalAlpha = 1 - t
    if (kind === 'prep-ready' && event.item) {
      this.drawItem(event.item, x - 24, y - 95 - Math.sin(t * Math.PI) * 24, 48, 58)
      const [column, row] = this.skin.sprites.sparkle
      for (let i = 0; i < 3; i++) {
        const angle = i * Math.PI * 2 / 3
        this.sprite(column, row, x - 12 + Math.cos(angle) * (30 + 24 * t), y - 80 + Math.sin(angle) * (22 + 20 * t), 24, 24)
      }
    } else if (kind === 'pay') {
      const [column, row] = this.skin.sprites.coin
      for (let i = 0; i < 4; i++) this.sprite(column, row, x - 14 + Math.cos(i * 2) * t * 65, y - 40 - Math.sin(t * Math.PI) * (40 + i * 5), 28, 28)
    } else {
      ctx.strokeStyle = this.skin.palette.strawberry
      ctx.lineWidth = 8 * (1 - t)
      ctx.beginPath(); ctx.arc(x, y - 20, 18 + t * 75, 0, Math.PI * 2); ctx.stroke()
    }
    ctx.restore()
  }

  // Revenue is critical feedback, so its label stays in CSS pixels instead of
  // shrinking with the world on tall phones.
  private drawPayAmount(x: number, y: number, age: number, amount: number, tip: number, combo: number, view: Viewport): void {
    const ctx = this.context
    const point = worldToClient(view, { x, y: y - 80 })
    const t = Math.min(1, age / .9)
    ctx.save()
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
    ctx.globalAlpha = 1 - t
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 5
    ctx.strokeStyle = this.skin.palette.cocoa
    ctx.fillStyle = this.skin.palette.sunshine
    const top = `+$${amount} TOTAL`
    const base = amount - tip - combo
    const parts = [`$${base} ORDER`]
    if (tip > 0) parts.push(`$${tip} TIP`)
    if (combo > 0) parts.push(`$${combo} COMBO`)
    const labelY = point.y - t * 24
    ctx.font = '900 22px ui-rounded, system-ui, sans-serif'
    ctx.strokeText(top, point.x, labelY - 9)
    ctx.fillText(top, point.x, labelY - 9)
    ctx.font = '900 13px ui-rounded, system-ui, sans-serif'
    ctx.lineWidth = 4
    const detail = parts.join(' · ')
    ctx.strokeText(detail, point.x, labelY + 12)
    ctx.fillText(detail, point.x, labelY + 12)
    ctx.restore()
  }

  private drawComboBreak(x: number, y: number, age: number, streak: number, view: Viewport): void {
    const ctx = this.context
    const point = worldToClient(view, { x, y: y - 80 })
    const t = Math.min(1, age / .9)
    ctx.save()
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
    ctx.globalAlpha = 1 - t
    ctx.font = '900 19px ui-rounded, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 5
    ctx.strokeStyle = this.skin.palette.cocoa
    ctx.fillStyle = this.skin.palette.strawberry
    const label = `COMBO LOST · ${streak}`
    ctx.strokeText(label, point.x, point.y - t * 20)
    ctx.fillText(label, point.x, point.y - t * 20)
    ctx.restore()
  }

  private interactionAge(state: GameState, matches: (event: GameEvent) => boolean): number | undefined {
    for (let index = state.events.length - 1; index >= 0; index--) {
      const event = state.events[index]
      const age = state.time - event.createdAt
      if (age >= 0 && age < MOTION_TIMES.DROP_LAND && matches(event)) return age
    }
    return undefined
  }

  private pickupRing(x: number, y: number, state: GameState, interaction: Point, contactAge?: number): void {
    const ctx = this.context
    const pose = interactionRingPose(
      state.time,
      Math.hypot(state.player.x - interaction.x, state.player.y - interaction.y),
      contactAge,
      this.reducedMotion,
    )
    ctx.save()
    ctx.strokeStyle = this.skin.palette.mint
    ctx.lineWidth = pose.lineWidth
    ctx.setLineDash([10, 12])
    ctx.lineDashOffset = pose.dashOffset
    ctx.beginPath(); ctx.ellipse(x, y, pose.radiusX, pose.radiusY, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }

  private drawJoystick(joystick: Joystick): void {
    const ctx = this.context
    ctx.save()
    ctx.globalAlpha = .65
    ctx.fillStyle = this.skin.palette.cream
    ctx.strokeStyle = this.skin.palette.cocoa
    ctx.lineWidth = 5
    ctx.beginPath(); ctx.arc(joystick.origin.x, joystick.origin.y, 52, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    const dx = joystick.current.x - joystick.origin.x
    const dy = joystick.current.y - joystick.origin.y
    const length = Math.max(1, Math.hypot(dx, dy))
    const reach = Math.min(34, length)
    ctx.fillStyle = this.skin.palette.strawberry
    ctx.beginPath(); ctx.arc(joystick.origin.x + dx / length * reach, joystick.origin.y + dy / length * reach, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.restore()
  }

  private shadow(x: number, y: number, rx: number, ry: number): void {
    const ctx = this.context
    ctx.fillStyle = 'rgba(74,59,69,.16)'
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill()
  }

  private sprite(column: number, row: number, x: number, y: number, width: number, height: number, flipX = false): void {
    if (!this.atlas.complete || !this.atlas.naturalWidth) return
    const [rx, ry, rw, rh] = this.skin.spriteRects[row][column]
    const scaleX = this.atlas.naturalWidth / 1254
    const scaleY = this.atlas.naturalHeight / 1254
    const ctx = this.context
    ctx.save()
    ctx.translate(flipX ? x + width : x, y)
    ctx.scale(flipX ? -1 : 1, 1)
    ctx.drawImage(this.atlas, rx * scaleX, ry * scaleY, rw * scaleX, rh * scaleY, 0, 0, width, height)
    ctx.restore()
  }

  private walkSheetSprite(frame: WalkSheetFrame, centerX: number, groundY: number): void {
    if (!this.playerWalkImage?.complete || !this.playerWalkImage.naturalWidth) return
    const placement = walkSheetPlacement(frame, centerX, groundY)
    const ctx = this.context
    ctx.save()
    ctx.translate(
      frame.flipX ? placement.destinationX + placement.destinationWidth : placement.destinationX,
      placement.destinationY,
    )
    ctx.scale(frame.flipX ? -1 : 1, 1)
    ctx.drawImage(
      this.playerWalkImage,
      placement.sourceX,
      placement.sourceY,
      placement.sourceWidth,
      placement.sourceHeight,
      0,
      0,
      placement.destinationWidth,
      placement.destinationHeight,
    )
    ctx.restore()
  }

  private drawItem(item: string, x: number, y: number, width: number, height: number): void {
    const image = this.itemImages.get(item)
    const ctx = this.context
    if (image?.complete && image.naturalWidth > 0) {
      ctx.drawImage(image, x, y, width, height)
      return
    }
    ctx.fillStyle = this.skin.items[item]?.color ?? this.skin.palette.sunshine
    ctx.strokeStyle = this.skin.palette.cocoa
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.ellipse(x + width / 2, y + height / 2, width * .35, height * .35, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  }
}

function inventoryItems(inventory: Record<string, number>): string[] {
  return Object.entries(inventory).flatMap(([item, count]) => Array(Math.max(0, count)).fill(item))
}

function withoutOne(items: string[], item?: string): string[] {
  if (!item) return items
  const index = items.indexOf(item)
  if (index >= 0) items.splice(index, 1)
  return items
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}
