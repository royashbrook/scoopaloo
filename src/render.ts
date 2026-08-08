import { byDepth, depthScale } from './depth'
import { inventoryTotal, prepSeconds, WORLD, type Customer, type GameEvent, type GameState, type Point } from './engine'
import type { GameSkin } from './skin'
import { prepPoint, producerPoint, stationPoint } from './skin'
import type { Viewport } from './viewport'
import { worldToClient } from './viewport'

type Joystick = { active: boolean; origin: Point; current: Point }
type Drawable = { anchor: Point; draw: () => void }

const TAU = Math.PI * 2
const REDUCED_MOTION_SCALE = .28
const PLAYER_EYES = { x: 17, y: -68, tone: '#fdcca9' }
const CUSTOMER_EYES = [
  { x: 15, y: -68, tone: '#fdcca9' },
  { x: -7, y: -68, tone: '#fdcca9' },
  { x: -18, y: -68, tone: '#fdcca9' },
  { x: -7, y: -68, tone: '#e79668' },
] as const

export const MOTION_TIMES = {
  WALK_CYCLE: .48,
  WALK_PLANT_A: .12,
  WALK_PASS: .24,
  WALK_PLANT_B: .36,
  CARRY_CYCLE: .54,
  CARRY_SETTLED: .4,
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
  MACHINE_PERIOD: 3.2,
  MACHINE_STAGGER: .67,
} as const

export type WalkPose = {
  stride: number
  x: number
  y: number
  lean: number
  shadowX: number
  shadowY: number
}

export type CarryPose = { x: number; y: number; rotation: number; amplitude: number }
export type TransferPose = Point & { scaleX: number; scaleY: number; rotation: number; progress: number }
export type MachinePose = { x: number; y: number; rotation: number; scaleY: number; pulse: number }

const motionScale = (reducedMotion: boolean): number => reducedMotion ? REDUCED_MOTION_SCALE : 1
const limit = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value))

export function walkPose(time: number, moving: boolean, facing: number, reducedMotion = false): WalkPose {
  if (!moving) return { stride: 0, x: 0, y: 0, lean: 0, shadowX: 43, shadowY: 13 }
  const scale = motionScale(reducedMotion)
  const stride = Math.sin(TAU * time / MOTION_TIMES.WALK_CYCLE)
  const lift = Math.abs(stride)
  return {
    stride,
    x: 2 * stride * facing * scale,
    y: -4 * lift * scale,
    lean: .045 * stride * facing * scale,
    shadowX: 43 + 4 * lift * scale,
    shadowY: 13 - 2 * lift * scale,
  }
}

export function carryPose(time: number, energy: number, load: number, facing: number, reducedMotion = false): CarryPose {
  const scale = motionScale(reducedMotion)
  const amplitude = limit(energy) * (1.2 + .9 * Math.min(Math.max(0, load), 5)) * scale
  const wave = Math.sin(TAU * time / MOTION_TIMES.CARRY_CYCLE)
  return {
    x: -facing * wave * amplitude,
    y: .35 * Math.abs(Math.cos(TAU * time / MOTION_TIMES.CARRY_CYCLE)) * amplitude,
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

export function machinePose(time: number, index: number, reducedMotion = false): MachinePose {
  const local = ((time + index * MOTION_TIMES.MACHINE_STAGGER) % MOTION_TIMES.MACHINE_PERIOD
    + MOTION_TIMES.MACHINE_PERIOD) % MOTION_TIMES.MACHINE_PERIOD
  const scale = motionScale(reducedMotion)
  if (local > MOTION_TIMES.MACHINE_END) return { x: 0, y: 0, rotation: 0, scaleY: 1, pulse: 0 }
  const pulse = Math.sin(Math.PI * local / MOTION_TIMES.MACHINE_END)
  const wave = Math.sin(TAU * local / MOTION_TIMES.MACHINE_END)
  return {
    x: 2.5 * wave * scale,
    y: -2 * pulse * scale,
    rotation: .018 * wave * scale,
    scaleY: 1 + .02 * pulse * scale,
    pulse,
  }
}

export class Renderer {
  readonly context: CanvasRenderingContext2D
  readonly atlas = new Image()
  readonly itemImages = new Map<string, HTMLImageElement>()
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(readonly canvas: HTMLCanvasElement, readonly skin: GameSkin) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas unavailable')
    this.context = context
    this.atlas.src = skin.spriteSheet
    for (const [id, item] of Object.entries(skin.items)) {
      const image = new Image()
      image.src = item.icon
      this.itemImages.set(id, image)
    }
  }

  assetsReady(): boolean {
    return this.atlas.complete && this.atlas.naturalWidth > 0
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
    this.drawRoom(state.time, view)

    // every drawable is one grounded unit (#14): sprite, shadow, stock, rings all
    // scale together around the unit's ground-contact anchor. byDepth is the ONLY
    // ordering rule; ties keep this list's order (stations, then creatures).
    const things: (Drawable & { anchor: Point })[] = [
      ...Object.entries(this.skin.producers).map(([source, producer]) => ({
        anchor: { x: producerPoint(this.skin, source).x, y: producer.depth },
        draw: () => this.drawProducer(state, source),
      })),
      ...Object.entries(this.skin.prepStations).map(([station, prep]) => ({
        anchor: { x: prepPoint(this.skin, station).x, y: prep.depth },
        draw: () => this.drawPrepStation(state, station),
      })),
      {
        anchor: { x: stationPoint(this.skin, 'counter').x, y: this.skin.stations.counter.depth },
        draw: () => this.drawCounter(state),
      },
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

  private drawRoom(time: number, view: Viewport): void {
    const ctx = this.context
    // paint the FULL visible world rect: portrait shows more wall above and more
    // floor below, wide screens show the room continuing left and right. no bars.
    const left = view.originX
    const top = view.originY
    const right = view.originX + view.viewWidth
    const bottom = view.originY + view.viewHeight
    ctx.fillStyle = this.skin.palette.cream
    ctx.fillRect(left, top, view.viewWidth, view.viewHeight)
    ctx.fillStyle = '#ffe7ca'
    ctx.fillRect(left, top, view.viewWidth, 165 - top)
    // perspective floor (#14): rays converge on one vanishing point at the center
    // of the wall/floor seam, rows compress toward the seam, so walking down the
    // screen reads as walking TOWARD the counter instead of across a flat sheet.
    ctx.strokeStyle = 'rgba(255,143,171,.16)'
    ctx.lineWidth = 2
    const vanish = { x: left + view.viewWidth / 2, y: 165 }
    for (let footX = left - view.viewWidth; footX <= right + view.viewWidth; footX += 96) {
      ctx.beginPath(); ctx.moveTo(vanish.x, vanish.y); ctx.lineTo(footX, bottom); ctx.stroke()
    }
    let rowY = 165
    let gap = 9
    while (rowY < bottom) {
      rowY += gap
      gap *= 1.22
      ctx.beginPath(); ctx.moveTo(left, rowY); ctx.lineTo(right, rowY); ctx.stroke()
    }
    ctx.fillStyle = this.skin.palette.strawberry
    rounded(ctx, 295, 35, 370, 92, 42)
    ctx.fill()
    ctx.fillStyle = this.skin.palette.cream
    for (let i = 0; i < 7; i++) {
      const x = 340 + i * 47
      ctx.beginPath(); ctx.arc(x, 82 + Math.sin(time * 2 + i) * 2, 15, 0, Math.PI * 2); ctx.fill()
    }
    ctx.fillStyle = 'rgba(74,59,69,.08)'
    ctx.fillRect(left, 158, view.viewWidth, 10)
  }

  private drawProducer(state: GameState, sourceId: string): void {
    const producer = this.skin.producers[sourceId]
    const source = state.sources[sourceId]
    const [x, y, width, height] = producer.draw
    const [column, row] = producer.sprite
    const point = producerPoint(this.skin, sourceId)
    if (!source) {
      const ctx = this.context
      ctx.save()
      ctx.globalAlpha = .35
      this.shadow(point.x, point.y + 6, width * .42, 22)
      this.sprite(column, row, x, y, width, height)
      ctx.restore()
      this.drawProducerPlaque(point, producer.item, true)
      return
    }

    const pose = machinePose(state.time, Object.keys(this.skin.producers).indexOf(sourceId), this.reducedMotion)
    this.shadow(point.x, point.y + 6, width * .42 * (1 + pose.pulse * .03), 22 * (1 - pose.pulse * .08))
    const ctx = this.context
    ctx.save()
    ctx.translate(point.x + pose.x, point.y + pose.y)
    ctx.rotate(pose.rotation)
    ctx.scale(1, pose.scaleY)
    ctx.translate(-point.x, -point.y)
    this.sprite(column, row, x, y, width, height)
    if (sourceId === this.skin.progression.startingStation) {
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
      this.drawItem(source.item, origin[0] + step[0] * i, origin[1] + step[1] * i, size[0], size[1])
    }
    ctx.restore()
    this.drawProducerPlaque(point, source.item, false)
    // Keep the nearest row's full ring on short tablet canvases while leaving
    // its interaction point unchanged.
    this.pickupRing(point.x, Math.min(point.y + 35, WORLD.height - 40), state.time)
  }

  private drawProducerPlaque(point: Point, item: string, locked: boolean): void {
    const ctx = this.context
    ctx.save()
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
      ctx.fillText('DAY 2', point.x, top + 65)
      ctx.restore()
      return
    }
    this.drawItem(item, point.x - 24, top + 5, 48, 56)
    ctx.restore()
  }

  private drawCounter(state: GameState): void {
    const station = this.skin.stations.counter
    const [x, y, width, height] = station.draw
    const [column, row] = station.sprite
    const counter = stationPoint(this.skin, 'counter')
    this.shadow(counter.x, counter.y + 8, 65, 18)
    this.sprite(column, row, x, y, width, height)
    const airborneDrop = this.airborneTransfer(state, 'drop')
    const stock = withoutOne(inventoryItems(state.counter.items), airborneDrop?.item)
    if (stock.length > 0) {
      const ctx = this.context
      ctx.fillStyle = this.skin.palette.cream
      ctx.strokeStyle = this.skin.palette.cocoa
      ctx.lineWidth = 4
      rounded(ctx, counter.x - 88, counter.y - 40, 82, 27, 12); ctx.fill(); ctx.stroke()
      stock.slice(0, 4).forEach((item, index) =>
        this.drawItem(item, counter.x - 82 + index * 20, counter.y - 71, 29, 38))
    }
    if (state.counter.serveTimer > 0) {
      const ctx = this.context
      ctx.strokeStyle = this.skin.palette.mint
      ctx.lineWidth = 8
      ctx.beginPath(); ctx.arc(counter.x, counter.y - 85, 24, -.5 * Math.PI, (-.5 + state.counter.serveTimer / .7 * 2) * Math.PI); ctx.stroke()
    }
  }

  private drawPrepStation(state: GameState, stationId: string): void {
    const station = this.skin.prepStations[stationId]
    const prep = state.prepStations[stationId]
    const [x, y, width, height] = station.draw
    const [column, row] = station.sprite
    const point = prepPoint(this.skin, stationId)
    this.shadow(point.x, point.y + 8, width * .42, 20)
    this.sprite(column, row, x, y, width, height)
    const { origin, step, size } = station.outputDisplay
    inventoryItems(prep.outputs).slice(0, station.capacity).forEach((item, index) =>
      this.drawItem(item, origin[0] + step[0] * index, origin[1] + step[1] * index, size[0], size[1]))
    if (prep.job) {
      const progress = 1 - prep.job.remaining / prepSeconds(state, prep.job.item)
      const ctx = this.context
      ctx.strokeStyle = this.skin.palette.mint
      ctx.lineWidth = 9
      ctx.beginPath()
      ctx.arc(point.x, point.y - 92, 31, -.5 * Math.PI, (-.5 + Math.max(0, Math.min(1, progress)) * 2) * Math.PI)
      ctx.stroke()
      this.drawItem(prep.job.item, point.x - 18, point.y - 115, 36, 45)
    }
    this.pickupRing(point.x, point.y + 34, state.time)
  }

  private drawPlayer(state: GameState): void {
    const player = state.player
    const walk = walkPose(state.time, player.moving, player.facing, this.reducedMotion)
    const airbornePickup = this.airborneTransfer(state, 'pickup')
    const airborneDrop = this.airborneTransfer(state, 'drop')
    const carried = withoutOne(inventoryItems(player.trayItems), airbornePickup?.item)
    const [column, row] = player.moving
      ? (player.facing < 0 ? this.skin.sprites.player.walkLeft : this.skin.sprites.player.walkRight)
      : this.skin.sprites.player.idle
    this.shadow(player.x, player.y + 5, walk.shadowX, walk.shadowY)
    if (player.moving) this.drawFootPatter(player, walk.stride)

    const ctx = this.context
    ctx.save()
    ctx.translate(player.x, player.y)
    ctx.rotate(walk.lean)
    ctx.translate(-player.x, -player.y)
    this.sprite(column, row, player.x - 66 + walk.x, player.y - 130 + walk.y, 132, 142)
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
      const carry = carryPose(state.time, player.trayWobble, load, player.facing, this.reducedMotion)
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
    const { look, x, y, served, missed } = customer
    const bob = Math.sin(time * 4 + look) * (this.reducedMotion ? .84 : 3)
    this.shadow(x, y + 4, 40, 12)
    const [customerColumn, customerRow] = this.skin.sprites.customers[look % this.skin.sprites.customers.length]
    const [heartColumn, heartRow] = this.skin.sprites.heart
    this.sprite(customerColumn, customerRow, x - 58, y - 122 + bob, 116, 132)
    const blink = blinkPose(time, customer.id * .73)
    const eyes = CUSTOMER_EYES[look % CUSTOMER_EYES.length]
    if (blink > 0) this.drawEyelids(x + eyes.x, y + eyes.y + bob, blink, eyes.tone)
    if (served) this.sprite(heartColumn, heartRow, x - 18, y - 160 + bob, 36, 36)
    if (missed) {
      const ctx = this.context
      ctx.fillStyle = this.skin.palette.strawberry
      ctx.strokeStyle = this.skin.palette.cocoa
      ctx.lineWidth = 4
      ctx.beginPath(); ctx.arc(x, y - 144 + bob, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.fillStyle = this.skin.palette.cream
      ctx.font = '900 30px system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('!', x, y - 143 + bob)
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
    if ((kind === 'pickup' || kind === 'drop') && event.item) {
      const age = Math.max(0, state.time - event.createdAt)
      const duration = kind === 'pickup' ? MOTION_TIMES.PICKUP_LAND : MOTION_TIMES.DROP_LAND
      if (age >= duration) return
      const origin = event.from ?? event
      const from = { x: origin.x, y: origin.y - 41 }
      let to = { x, y: y - 52 }
      if (kind === 'pickup') {
        const player = state.player
        const walk = walkPose(state.time, player.moving, player.facing, this.reducedMotion)
        const carry = carryPose(state.time, player.trayWobble, Math.max(1, player.tray), player.facing, this.reducedMotion)
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

  private pickupRing(x: number, y: number, time: number): void {
    const ctx = this.context
    ctx.save()
    ctx.strokeStyle = this.skin.palette.mint
    ctx.lineWidth = 4
    ctx.setLineDash([10, 12])
    ctx.lineDashOffset = -time * 18
    ctx.beginPath(); ctx.ellipse(x, y, 67, 29, 0, 0, Math.PI * 2); ctx.stroke()
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

  private sprite(column: number, row: number, x: number, y: number, width: number, height: number, local = false): void {
    if (!this.atlas.complete || !this.atlas.naturalWidth) return
    const [rx, ry, rw, rh] = this.skin.spriteRects[row][column]
    const scaleX = this.atlas.naturalWidth / 1254
    const scaleY = this.atlas.naturalHeight / 1254
    const ctx = this.context
    ctx.save()
    if (!local) ctx.translate(x, y)
    else ctx.translate(x, y)
    ctx.drawImage(this.atlas, rx * scaleX, ry * scaleY, rw * scaleX, rh * scaleY, 0, 0, width, height)
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
