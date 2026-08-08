import type { GameState, Point } from './engine'
import { WORLD } from './engine'
import type { GameSkin } from './skin'
import { stationPoint } from './skin'

type Joystick = { active: boolean; origin: Point; current: Point }
type Drawable = { y: number; draw: () => void }

export class Renderer {
  readonly context: CanvasRenderingContext2D
  readonly atlas = new Image()
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(readonly canvas: HTMLCanvasElement, readonly skin: GameSkin) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas unavailable')
    this.context = context
    this.atlas.src = skin.spriteSheet
  }

  draw(state: GameState, joystick: Joystick): void {
    const ctx = this.context
    ctx.clearRect(0, 0, WORLD.width, WORLD.height)
    this.drawRoom(state.time)

    const things: Drawable[] = [
      { y: this.skin.stations.machine.depth, draw: () => this.drawMachine(state) },
      { y: this.skin.stations.counter.depth, draw: () => this.drawCounter(state) },
      { y: this.skin.stations.build.depth, draw: () => this.drawBuild(state) },
      ...state.customers.map(customer => ({ y: customer.y, draw: () => this.drawCustomer(customer.look, customer.x, customer.y, customer.served, state.time) })),
      { y: state.player.y, draw: () => this.drawPlayer(state) },
    ]
    things.sort((a, b) => a.y - b.y).forEach(item => item.draw())
    state.flyingCoins.forEach(coin => this.drawCoin(coin.x, coin.y, coin.age))
    state.events.forEach(event => this.drawEvent(event.kind, event.x, event.y, event.age))
    this.drawHud(state)
    if (joystick.active) this.drawJoystick(joystick)
  }

  private drawRoom(time: number): void {
    const ctx = this.context
    ctx.fillStyle = this.skin.palette.cream
    ctx.fillRect(0, 0, WORLD.width, WORLD.height)
    ctx.fillStyle = '#ffe7ca'
    ctx.fillRect(0, 0, WORLD.width, 165)
    ctx.strokeStyle = 'rgba(255,143,171,.16)'
    ctx.lineWidth = 2
    for (let x = -640; x < 1200; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 165); ctx.lineTo(x + 520, 640); ctx.stroke()
    }
    for (let y = 165; y < 640; y += 54) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(960, y); ctx.stroke()
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
    ctx.fillRect(0, 158, 960, 10)
  }

  private drawMachine(state: GameState): void {
    const [x, y, width, height] = this.skin.stations.machine.draw
    const [column, row] = this.skin.stations.machine.sprite
    const machine = stationPoint(this.skin, 'machine')
    this.shadow(machine.x, machine.y + 6, 76, 22)
    this.sprite(column, row, x, y, width, height)
    const ctx = this.context
    ctx.save()
    ctx.strokeStyle = this.skin.palette.strawberry
    ctx.lineWidth = 6
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.ellipse(190, 213 + i * 7, 17 - i * 3, 5, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
    const [itemColumn, itemRow] = this.skin.sprites.item
    for (let i = 0; i < state.machine.stock; i++) this.sprite(itemColumn, itemRow, 145 + i * 34, 273 - i * 3, 48, 58)
    this.pickupRing(machine.x, machine.y + 35, state.time)
  }

  private drawCounter(state: GameState): void {
    const [counterX, counterY, counterWidth, counterHeight] = this.skin.stations.counter.draw
    const [counterColumn, counterRow] = this.skin.stations.counter.sprite
    const [registerX, registerY, registerWidth, registerHeight] = this.skin.stations.register.draw
    const [registerColumn, registerRow] = this.skin.stations.register.sprite
    this.shadow(650, 352, 150, 25)
    this.sprite(counterColumn, counterRow, counterX, counterY, counterWidth, counterHeight)
    this.sprite(registerColumn, registerRow, registerX, registerY, registerWidth, registerHeight)
    const [itemColumn, itemRow] = this.skin.sprites.item
    for (let i = 0; i < state.counter.stock; i++) this.sprite(itemColumn, itemRow, 590 + i * 42, 238, 52, 63)
    if (state.counter.serveTimer > 0) {
      const ctx = this.context
      ctx.strokeStyle = this.skin.palette.mint
      ctx.lineWidth = 8
      ctx.beginPath(); ctx.arc(800, 250, 24, -.5 * Math.PI, (-.5 + state.counter.serveTimer / .7 * 2) * Math.PI); ctx.stroke()
    }
  }

  private drawBuild(state: GameState): void {
    const [x, y, width, height] = this.skin.stations.build.draw
    const [column, row] = this.skin.stations.build.sprite
    const build = stationPoint(this.skin, 'build')
    this.shadow(build.x, build.y + 18, 75, 18)
    this.sprite(column, row, x, y, width, height)
    const upgraded = state.save.upgrades.shoes > 0
    if (!upgraded) {
      for (let i = 0; i < 8; i++) {
        const angle = i / 8 * Math.PI * 2
        this.drawCoin(205 + Math.cos(angle) * 53, 478 + Math.sin(angle) * 25, i * .1)
      }
    } else {
      const ctx = this.context
      ctx.fillStyle = this.skin.palette.mint
      rounded(ctx, 164, 435, 82, 48, 18); ctx.fill()
      ctx.fillStyle = this.skin.palette.cream
      ctx.beginPath(); ctx.ellipse(190, 458, 20, 8, -.25, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.ellipse(220, 458, 20, 8, .25, 0, Math.PI * 2); ctx.fill()
    }
  }

  private drawPlayer(state: GameState): void {
    const player = state.player
    const stride = player.moving && !this.reducedMotion ? Math.sin(state.time * 13) : 0
    const bob = Math.abs(stride) * -4
    const [column, row] = player.tray > 0
      ? this.skin.sprites.player.carry
      : player.moving
        ? (player.facing < 0 ? this.skin.sprites.player.walkLeft : this.skin.sprites.player.walkRight)
        : this.skin.sprites.player.idle
    const carryWobble = player.tray > 0 && !this.reducedMotion ? Math.sin(player.trayWobble) * 2 : 0
    this.shadow(player.x, player.y + 5, 43 + Math.abs(stride) * 4, 13)
    this.sprite(column, row, player.x - 66 + carryWobble, player.y - 130 + bob, 132, 142)
  }

  private drawCustomer(look: number, x: number, y: number, served: boolean, time: number): void {
    const bob = this.reducedMotion ? 0 : Math.sin(time * 4 + look) * 3
    this.shadow(x, y + 4, 40, 12)
    const [customerColumn, customerRow] = this.skin.sprites.customers[look % this.skin.sprites.customers.length]
    const [heartColumn, heartRow] = this.skin.sprites.heart
    this.sprite(customerColumn, customerRow, x - 58, y - 122 + bob, 116, 132)
    if (served) this.sprite(heartColumn, heartRow, x - 18, y - 160 + bob, 36, 36)
  }

  private drawCoin(x: number, y: number, age: number): void {
    const pulse = this.reducedMotion ? 1 : .9 + Math.sin(age * 12) * .1
    const [column, row] = this.skin.sprites.coin
    this.sprite(column, row, x - 15 * pulse, y - 15 * pulse, 30 * pulse, 30 * pulse)
  }

  private drawEvent(kind: string, x: number, y: number, age: number): void {
    const ctx = this.context
    const t = Math.min(1, age / .75)
    ctx.save()
    ctx.globalAlpha = 1 - t
    if (kind === 'pickup' || kind === 'drop') {
      const direction = kind === 'pickup' ? -1 : 1
      const arcY = y - 45 - Math.sin(t * Math.PI) * 45 * direction
      const [column, row] = this.skin.sprites.item
      this.sprite(column, row, x - 22 + t * 20 * direction, arcY, 44, 52)
    } else if (kind === 'pay') {
      const [column, row] = this.skin.sprites.coin
      for (let i = 0; i < 5; i++) this.sprite(column, row, x - 14 + Math.cos(i * 2) * t * 65, y - 40 - Math.sin(t * Math.PI) * (40 + i * 5), 28, 28)
    } else {
      ctx.strokeStyle = kind === 'build' ? this.skin.palette.sunshine : this.skin.palette.strawberry
      ctx.lineWidth = 8 * (1 - t)
      ctx.beginPath(); ctx.arc(x, y - 20, 18 + t * 75, 0, Math.PI * 2); ctx.stroke()
    }
    ctx.restore()
  }

  private drawHud(state: GameState): void {
    const ctx = this.context
    ctx.fillStyle = 'rgba(255,243,230,.9)'
    rounded(ctx, 24, 20, 54 + Math.min(10, state.save.coins) * 21, 58, 29); ctx.fill()
    ctx.strokeStyle = this.skin.palette.cocoa; ctx.lineWidth = 4; ctx.stroke()
    const [coinColumn, coinRow] = this.skin.sprites.coin
    this.sprite(coinColumn, coinRow, 34, 29, 39, 39)
    for (let i = 0; i < Math.min(10, state.save.coins); i++) {
      ctx.fillStyle = this.skin.palette.sunshine
      ctx.beginPath(); ctx.arc(88 + i * 20, 49, 8, 0, Math.PI * 2); ctx.fill()
    }
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
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}
