import type { GameState, Point } from './engine'
import { POSITIONS, WORLD } from './engine'
import skin from './skins/ice-cream.json'

type Joystick = { active: boolean; origin: Point; current: Point }
type Drawable = { y: number; draw: () => void }

const palette = skin.palette
const atlasRects = [
  [[92, 34, 196, 318], [386, 31, 186, 320], [690, 33, 196, 320], [993, 34, 191, 319]],
  [[68, 371, 214, 309], [352, 365, 211, 315], [686, 365, 207, 315], [966, 358, 224, 322]],
  [[76, 697, 190, 246], [326, 694, 232, 258], [610, 702, 307, 251], [963, 706, 230, 253]],
  [[55, 979, 222, 207], [338, 989, 234, 192], [638, 975, 237, 215], [914, 994, 291, 197]],
] as const

export class Renderer {
  readonly context: CanvasRenderingContext2D
  readonly atlas = new Image()
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(readonly canvas: HTMLCanvasElement) {
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
      { y: 190, draw: () => this.drawMachine(state) },
      { y: 255, draw: () => this.drawCounter(state) },
      { y: 475, draw: () => this.drawBuild(state) },
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
    ctx.fillStyle = palette.cream
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
    ctx.fillStyle = palette.strawberry
    rounded(ctx, 295, 35, 370, 92, 42)
    ctx.fill()
    ctx.fillStyle = palette.cream
    for (let i = 0; i < 7; i++) {
      const x = 340 + i * 47
      ctx.beginPath(); ctx.arc(x, 82 + Math.sin(time * 2 + i) * 2, 15, 0, Math.PI * 2); ctx.fill()
    }
    ctx.fillStyle = 'rgba(74,59,69,.08)'
    ctx.fillRect(0, 158, 960, 10)
  }

  private drawMachine(state: GameState): void {
    this.shadow(POSITIONS.machine.x, POSITIONS.machine.y + 6, 76, 22)
    this.sprite(1, 2, 100, 105, 175, 190)
    const ctx = this.context
    ctx.save()
    ctx.strokeStyle = palette.strawberry
    ctx.lineWidth = 6
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.ellipse(190, 213 + i * 7, 17 - i * 3, 5, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
    for (let i = 0; i < state.machine.stock; i++) this.sprite(0, 2, 145 + i * 34, 273 - i * 3, 48, 58)
    this.pickupRing(POSITIONS.machine.x, POSITIONS.machine.y + 35, state.time)
  }

  private drawCounter(state: GameState): void {
    this.shadow(650, 352, 150, 25)
    this.sprite(2, 2, 525, 200, 245, 195)
    this.sprite(3, 2, 704, 235, 110, 105)
    for (let i = 0; i < state.counter.stock; i++) this.sprite(0, 2, 590 + i * 42, 238, 52, 63)
    if (state.counter.serveTimer > 0) {
      const ctx = this.context
      ctx.strokeStyle = palette.mint
      ctx.lineWidth = 8
      ctx.beginPath(); ctx.arc(800, 250, 24, -.5 * Math.PI, (-.5 + state.counter.serveTimer / .7 * 2) * Math.PI); ctx.stroke()
    }
  }

  private drawBuild(state: GameState): void {
    this.shadow(POSITIONS.build.x, POSITIONS.build.y + 18, 75, 18)
    this.sprite(3, 3, 130, 420, 150, 125)
    const upgraded = state.save.upgrades.shoes > 0
    if (!upgraded) {
      for (let i = 0; i < 8; i++) {
        const angle = i / 8 * Math.PI * 2
        this.drawCoin(205 + Math.cos(angle) * 53, 478 + Math.sin(angle) * 25, i * .1)
      }
    } else {
      const ctx = this.context
      ctx.fillStyle = palette.mint
      rounded(ctx, 164, 435, 82, 48, 18); ctx.fill()
      ctx.fillStyle = palette.cream
      ctx.beginPath(); ctx.ellipse(190, 458, 20, 8, -.25, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.ellipse(220, 458, 20, 8, .25, 0, Math.PI * 2); ctx.fill()
    }
  }

  private drawPlayer(state: GameState): void {
    const player = state.player
    const stride = player.moving && !this.reducedMotion ? Math.sin(state.time * 13) : 0
    const bob = Math.abs(stride) * -4
    const col = player.tray > 0 ? 0 : player.moving ? (player.facing < 0 ? 1 : 2) : 0
    this.shadow(player.x, player.y + 5, 43 + Math.abs(stride) * 4, 13)
    this.sprite(col, 0, player.x - 66, player.y - 130 + bob, 132, 142)
    if (player.tray > 0) {
      const wobble = this.reducedMotion ? 0 : Math.sin(player.trayWobble) * .06
      const ctx = this.context
      ctx.save()
      ctx.translate(player.x, player.y - 58)
      ctx.rotate(wobble)
      ctx.fillStyle = palette.cocoa
      rounded(ctx, -48, -5, 96, 10, 5); ctx.fill()
      for (let i = 0; i < player.tray; i++) this.sprite(0, 2, -43 + i * 34, -48, 42, 50, true)
      ctx.restore()
    }
  }

  private drawCustomer(look: number, x: number, y: number, served: boolean, time: number): void {
    const bob = this.reducedMotion ? 0 : Math.sin(time * 4 + look) * 3
    this.shadow(x, y + 4, 40, 12)
    this.sprite(look, 1, x - 58, y - 122 + bob, 116, 132)
    if (served) this.sprite(1, 3, x - 18, y - 160 + bob, 36, 36)
  }

  private drawCoin(x: number, y: number, age: number): void {
    const pulse = this.reducedMotion ? 1 : .9 + Math.sin(age * 12) * .1
    this.sprite(0, 3, x - 15 * pulse, y - 15 * pulse, 30 * pulse, 30 * pulse)
  }

  private drawEvent(kind: string, x: number, y: number, age: number): void {
    const ctx = this.context
    const t = Math.min(1, age / .75)
    ctx.save()
    ctx.globalAlpha = 1 - t
    if (kind === 'pickup' || kind === 'drop') {
      const direction = kind === 'pickup' ? -1 : 1
      const arcY = y - 45 - Math.sin(t * Math.PI) * 45 * direction
      this.sprite(0, 2, x - 22 + t * 20 * direction, arcY, 44, 52)
    } else if (kind === 'pay') {
      for (let i = 0; i < 5; i++) this.sprite(0, 3, x - 14 + Math.cos(i * 2) * t * 65, y - 40 - Math.sin(t * Math.PI) * (40 + i * 5), 28, 28)
    } else {
      ctx.strokeStyle = kind === 'build' ? palette.sunshine : palette.strawberry
      ctx.lineWidth = 8 * (1 - t)
      ctx.beginPath(); ctx.arc(x, y - 20, 18 + t * 75, 0, Math.PI * 2); ctx.stroke()
    }
    ctx.restore()
  }

  private drawHud(state: GameState): void {
    const ctx = this.context
    ctx.fillStyle = 'rgba(255,243,230,.9)'
    rounded(ctx, 24, 20, 54 + Math.min(10, state.save.coins) * 21, 58, 29); ctx.fill()
    ctx.strokeStyle = palette.cocoa; ctx.lineWidth = 4; ctx.stroke()
    this.sprite(0, 3, 34, 29, 39, 39)
    for (let i = 0; i < Math.min(10, state.save.coins); i++) {
      ctx.fillStyle = palette.sunshine
      ctx.beginPath(); ctx.arc(88 + i * 20, 49, 8, 0, Math.PI * 2); ctx.fill()
    }
  }

  private pickupRing(x: number, y: number, time: number): void {
    const ctx = this.context
    ctx.save()
    ctx.strokeStyle = palette.mint
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
    ctx.fillStyle = palette.cream
    ctx.strokeStyle = palette.cocoa
    ctx.lineWidth = 5
    ctx.beginPath(); ctx.arc(joystick.origin.x, joystick.origin.y, 52, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    const dx = joystick.current.x - joystick.origin.x
    const dy = joystick.current.y - joystick.origin.y
    const length = Math.max(1, Math.hypot(dx, dy))
    const reach = Math.min(34, length)
    ctx.fillStyle = palette.strawberry
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
    const [rx, ry, rw, rh] = atlasRects[row][column]
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
