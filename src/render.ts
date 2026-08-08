import { byDepth, depthScale } from './depth'
import { inventoryTotal, type GameEvent, type GameState, type Point } from './engine'
import type { GameSkin, SkinUpgrade } from './skin'
import { nextUpgrade, producerPoint, stationPoint, upgradeSpot } from './skin'
import type { Viewport } from './viewport'
import { worldToClient } from './viewport'

type Joystick = { active: boolean; origin: Point; current: Point }
type Drawable = { anchor: Point; draw: () => void }

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
    // ordering rule; ties keep this list's order (stations, spots, creatures).
    const things: (Drawable & { anchor: Point })[] = [
      ...Object.entries(this.skin.producers).map(([source, producer]) => ({
        anchor: { x: producerPoint(this.skin, source).x, y: producer.depth },
        draw: () => this.drawProducer(state, source),
      })),
      {
        anchor: { x: stationPoint(this.skin, 'counter').x, y: this.skin.stations.counter.depth },
        draw: () => this.drawCounter(state),
      },
      ...this.upgradeSpots(state),
      ...state.customers.map(customer => ({ anchor: { x: customer.x, y: customer.y }, draw: () => this.drawCustomer(customer.look, customer.x, customer.y, customer.served, customer.missed, state.time) })),
      { anchor: { x: state.player.x, y: state.player.y }, draw: () => this.drawPlayer(state) },
    ]
    things.sort(byDepth).forEach(item => this.grounded(item.anchor, item.draw))
    state.flyingCoins.forEach(coin => this.grounded({ x: coin.x, y: coin.y }, () => this.drawCoin(coin.x, coin.y, coin.age)))
    state.events.forEach(event => this.grounded({ x: event.x, y: event.y }, () => this.drawEvent(event)))
    state.events.filter(event => event.kind === 'pay' && event.amount).forEach(event =>
      this.drawPayAmount(event.x, event.y, event.age, event.amount ?? 0, event.tip ?? 0, view))
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
    this.shadow(point.x, point.y + 6, width * .42, 22)
    this.sprite(column, row, x, y, width, height)
    if (sourceId === this.skin.progression.startingStation) {
      const ctx = this.context
      ctx.save()
      ctx.strokeStyle = this.skin.palette.strawberry
      ctx.lineWidth = 6
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.ellipse(point.x, point.y - 47 + i * 7, 17 - i * 3, 5, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }
    const { origin, step, size } = producer.stockDisplay
    for (let i = 0; i < source.stock; i++) {
      this.drawItem(source.item, origin[0] + step[0] * i, origin[1] + step[1] * i, size[0], size[1])
    }
    this.pickupRing(point.x, point.y + 35, state.time)
  }

  private drawCounter(state: GameState): void {
    const station = this.skin.stations.counter
    const [x, y, width, height] = station.draw
    const [column, row] = station.sprite
    const counter = stationPoint(this.skin, 'counter')
    this.shadow(counter.x, counter.y + 8, 65, 18)
    this.sprite(column, row, x, y, width, height)
    const stock = inventoryItems(state.counter.items)
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

  private upgradeSpots(state: GameState): Drawable[] {
    const next = nextUpgrade(this.skin, state.save.upgrades)
    return this.skin.upgrades
      .filter(upgrade => state.save.upgrades[upgrade.id] > 0 || upgrade === next)
      .map(upgrade => ({
        anchor: upgradeSpot(upgrade),
        draw: () => this.drawUpgradeSpot(state, upgrade, state.save.upgrades[upgrade.id] > 0),
      }))
  }

  // Upgrade spots follow the skin's declared order. Only the NEXT unowned spot is
  // visible (a hidden future is a wordless "not yet"); owned spots keep a small
  // sparkle marker so progress reads at a glance. Price coins are GHOSTS: faded,
  // static, and ringed, so they cannot be mistaken for collectible floor coins (#5).
  private drawUpgradeSpot(state: GameState, upgrade: SkinUpgrade, owned: boolean): void {
    const ctx = this.context
    const spot = upgradeSpot(upgrade)
    this.shadow(spot.x, spot.y + 18, 75, 18)
    this.sprite(3, 3, spot.x - 75, spot.y - 85, 150, 125)
    if (owned) {
      const [column, row] = this.skin.sprites.sparkle
      this.sprite(column, row, spot.x - 16, spot.y - 55, 32, 32)
      return
    }
    const affordable = state.save.coins >= upgrade.price
    const pulse = affordable && !this.reducedMotion ? 1 + Math.sin(state.time * 6) * .08 : 1
    ctx.save()
    ctx.strokeStyle = affordable ? this.skin.palette.mint : this.skin.palette.cocoa
    ctx.globalAlpha = affordable ? .9 : .4
    ctx.lineWidth = 5
    ctx.setLineDash([12, 10])
    ctx.beginPath(); ctx.ellipse(spot.x, spot.y - 4, 82 * pulse, 34 * pulse, 0, 0, Math.PI * 2); ctx.stroke()
    // ghost coins: exactly ONE per coin of price, because in a zero-text economy the
    // coins ARE the price tag and a rounded count is a lie. concentric rings pack up
    // to 22 (the dearest declared upgrade); a pricier future skin should rethink the
    // marker before this draws misleadingly.
    ctx.globalAlpha = .35
    const [column, row] = this.skin.sprites.coin
    const rings = [{ n: 12, r: 53 }, { n: 7, r: 33 }, { n: 3, r: 14 }]
    let remaining = Math.min(upgrade.price, 22)
    for (const ring of rings) {
      const count = Math.min(remaining, ring.n)
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2
        this.sprite(column, row, spot.x + Math.cos(angle) * ring.r - 10, spot.y - 8 + Math.sin(angle) * ring.r * .42 - 10, 20, 20)
      }
      remaining -= count
      if (remaining === 0) break
    }
    ctx.restore()
  }

  private drawPlayer(state: GameState): void {
    const player = state.player
    const stride = player.moving && !this.reducedMotion ? Math.sin(state.time * 13) : 0
    const bob = Math.abs(stride) * -4
    const carried = inventoryItems(player.trayItems)
    const [column, row] = player.moving
      ? (player.facing < 0 ? this.skin.sprites.player.walkLeft : this.skin.sprites.player.walkRight)
      : this.skin.sprites.player.idle
    const carryWobble = player.tray > 0 && !this.reducedMotion ? Math.sin(player.trayWobble) * 2 : 0
    this.shadow(player.x, player.y + 5, 43 + Math.abs(stride) * 4, 13)
    this.sprite(column, row, player.x - 66 + carryWobble, player.y - 130 + bob, 132, 142)
    if (carried.length > 0) {
      const ctx = this.context
      const itemWidth = Math.min(34, 82 / carried.length)
      const trayWidth = Math.max(58, carried.length * itemWidth + 12)
      const trayX = player.x - trayWidth / 2 + carryWobble
      const trayY = player.y - 25 + bob
      carried.slice(0, 5).forEach((item, index) => {
        const start = player.x - carried.length * itemWidth / 2 + carryWobble
        this.drawItem(item, start + index * itemWidth, trayY - 36, itemWidth, 40)
      })
      ctx.fillStyle = this.skin.palette.cocoa
      ctx.strokeStyle = this.skin.palette.cocoa
      ctx.lineWidth = 2
      rounded(ctx, trayX, trayY, trayWidth, 8, 4); ctx.fill(); ctx.stroke()
    }
  }

  private drawCustomer(look: number, x: number, y: number, served: boolean, missed: boolean, time: number): void {
    const bob = this.reducedMotion ? 0 : Math.sin(time * 4 + look) * 3
    this.shadow(x, y + 4, 40, 12)
    const [customerColumn, customerRow] = this.skin.sprites.customers[look % this.skin.sprites.customers.length]
    const [heartColumn, heartRow] = this.skin.sprites.heart
    this.sprite(customerColumn, customerRow, x - 58, y - 122 + bob, 116, 132)
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

  private drawEvent(event: GameEvent): void {
    const ctx = this.context
    const { kind, x, y } = event
    const t = Math.min(1, event.age / .75)
    ctx.save()
    ctx.globalAlpha = 1 - t
    if ((kind === 'pickup' || kind === 'drop') && event.item) {
      const direction = kind === 'pickup' ? -1 : 1
      const arcY = y - 45 - Math.sin(t * Math.PI) * 45 * direction
      this.drawItem(event.item, x - 22 + t * 20 * direction, arcY, 44, 52)
    } else if (kind === 'pay') {
      const [column, row] = this.skin.sprites.coin
      for (let i = 0; i < 4; i++) this.sprite(column, row, x - 14 + Math.cos(i * 2) * t * 65, y - 40 - Math.sin(t * Math.PI) * (40 + i * 5), 28, 28)
    } else {
      ctx.strokeStyle = kind === 'build' ? this.skin.palette.sunshine : this.skin.palette.strawberry
      ctx.lineWidth = 8 * (1 - t)
      ctx.beginPath(); ctx.arc(x, y - 20, 18 + t * 75, 0, Math.PI * 2); ctx.stroke()
    }
    ctx.restore()
  }

  // Revenue is critical feedback, so its label stays in CSS pixels instead of
  // shrinking with the world on tall phones.
  private drawPayAmount(x: number, y: number, age: number, amount: number, tip: number, view: Viewport): void {
    const ctx = this.context
    const point = worldToClient(view, { x, y: y - 80 })
    const t = Math.min(1, age / .9)
    ctx.save()
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
    ctx.globalAlpha = 1 - t
    ctx.font = '900 22px ui-rounded, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 5
    ctx.strokeStyle = this.skin.palette.cocoa
    ctx.fillStyle = this.skin.palette.sunshine
    const label = tip > 0 ? `+$${amount}  $${tip} TIP` : `+$${amount}`
    ctx.strokeText(label, point.x, point.y - t * 24)
    ctx.fillText(label, point.x, point.y - t * 24)
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

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}
