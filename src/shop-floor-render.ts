import { Renderer, walkSheetFrame, walkSheetPlacement } from './render'
import { FLOOR, nextFloorPurchase, type FloorState, type Walker } from './shop-floor'
import type { GameSkin } from './skin'
import type { Viewport } from './viewport'

const ink = '#4A3B45', mint = '#63CDB4', cream = '#FFF3E6'
export class FloorRenderer {
  readonly art: Renderer
  constructor(readonly canvas: HTMLCanvasElement, readonly skin: GameSkin) {
    this.art = new Renderer(canvas, skin)
  }
  private get ctx() { return this.art.context }
  private box(x: number, y: number, w: number, h: number, fill: string, radius = 16, stroke = ink) {
    const c = this.ctx
    c.fillStyle = fill; c.strokeStyle = stroke; c.lineWidth = 3
    c.beginPath(); c.roundRect(x, y, w, h, radius); c.fill(); c.stroke()
  }
  private text(text: string, x: number, y: number, size = 24, color = ink) {
    const c = this.ctx
    c.font = `800 ${size}px "Scoop", ui-rounded, system-ui, sans-serif`
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color
    c.fillText(text, x, y)
  }
  private sprite(col: number, row: number, x: number, y: number, w: number, h: number) {
    const { atlas } = this.art
    if (!atlas.naturalWidth) return
    const [sx, sy, sw, sh] = this.skin.spriteRects[row][col]
    const k = atlas.naturalWidth / 1254
    this.ctx.drawImage(atlas, sx * k, sy * k, sw * k, sh * k, x, y, w, h)
  }
  private cone(x: number, y: number, size = 36) {
    const img = this.art.itemImages.get('vanilla-cone')
    if (img?.naturalWidth) this.ctx.drawImage(img, x - size / 2, y - size, size, size * 1.2)
  }
  private shadow(x: number, y: number, width = 30) {
    const c = this.ctx
    c.fillStyle = '#4a3b4525'; c.beginPath(); c.ellipse(x, y, width, 9, 0, 0, Math.PI * 2); c.fill()
  }
  private ring(x: number, y: number, width: number, active: boolean) {
    const c = this.ctx
    c.save(); c.strokeStyle = active ? '#137b64' : '#4a3b4560'; c.lineWidth = active ? 5 : 3
    c.setLineDash([9, 8]); c.beginPath(); c.ellipse(x, y, width, width * .4, 0, 0, Math.PI * 2); c.stroke(); c.restore()
  }

  draw(state: FloorState, view: Viewport, joystick: { active: boolean; origin: { x: number; y: number }; current: { x: number; y: number } }) {
    const c = this.ctx, k = view.scale * view.dpr
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.fillStyle = '#cce8d3'; c.fillRect(0, 0, this.canvas.width, this.canvas.height)
    c.setTransform(k, 0, 0, k, -view.originX * k, -view.originY * k)
    this.room(state)
    const purchase = nextFloorPurchase(state)
    if (purchase) {
      const affordable = state.save.cash >= purchase.price
      this.box(purchase.x - 85, purchase.y - 37, 170, 74, affordable ? '#fff3b4' : '#fff9ef', 18, affordable ? '#967224' : '#b8a798')
      this.text(purchase.label, purchase.x, purchase.y - 11, 22)
      this.text(`$${purchase.price}`, purchase.x, purchase.y + 17, 26, affordable ? '#156d58' : '#756253')
      if (state.buildHold) {
        c.strokeStyle = '#137b64'; c.lineWidth = 7; c.beginPath()
        c.arc(purchase.x, purchase.y, 56, -Math.PI / 2, -Math.PI / 2 + state.buildHold / .6 * Math.PI * 2); c.stroke()
      }
    }
    this.ring(FLOOR.scoop.x, FLOOR.scoop.y, 56, state.player.cones === 0)
    this.sprite(1, 2, 90, 275, 120, 145)
    for (let n = 0; n < 3; n++) this.cone(123 + n * 28, 409, 32)
    this.text('PICK UP', 150, 492, 22)
    const actors: { y: number; draw: () => void }[] = state.customers.map(customer => ({
      y: customer.y, draw: () => {
        c.save()
        c.globalAlpha = Math.min(1, Math.max(0, (FLOOR.entranceX + 10 - customer.x) / 25))
        this.shadow(customer.x, customer.y)
        // Breathe around a planted footprint; idle life is not walking in place.
        const breath = this.art.reducedMotion ? 0 : Math.sin(state.time * 2.4 + customer.id) * 1.2
        this.sprite(customer.id % 4, 1, customer.x - 36, customer.y - 85 - breath, 72, 89 + breath)
        if (customer.leaving) {
          this.sprite(1, 3, customer.x - 16, customer.y - 120, 32, 28)
          this.cone(customer.x + 18, customer.y - 22, 26)
        }
        c.restore()
      },
    }))
    for (let lane = 0; lane < (state.save.party ? 3 : state.save.patio ? 2 : 1); lane++) {
      const pos = FLOOR.counters[lane]
      actors.push({ y: pos.y - 25, draw: () => lane === 2 ? this.partyTable(state) : this.counter(pos.x, pos.y, state.player.cones > 0) })
    }
    actors.push({ y: state.player.y, draw: () => this.actor(state.player, false, state.time) })
    if (state.save.helper) actors.push({ y: state.helper.y, draw: () => this.actor(state.helper, true, state.time) })
    actors.sort((a, b) => a.y - b.y).forEach(actor => actor.draw())
    for (const customer of state.customers.filter(c => !c.leaving && c.x <= FLOOR.counters[c.lane].x + 6)) {
      this.box(customer.x - 40, customer.y - 165, 80, 67, '#fffcf5', 20)
      this.cone(customer.x - 8, customer.y - 131, 28)
      this.text('1', customer.x + 20, customer.y - 129, 24)
    }
    for (const event of state.events) {
      c.save()
      const progress = Math.min(1, event.age / .28)
      if (event.kind === 'pickup' && progress < 1 && event.from) {
        const actor = event.helper ? state.helper : state.player
        this.cone(event.from.x + (actor.x - event.from.x) * progress,
          event.from.y + (actor.y - 45 - event.from.y) * progress - (this.art.reducedMotion ? 0 : Math.sin(progress * Math.PI) * 32))
      }
      if (event.kind === 'pay') {
        if (progress < 1 && event.from) this.cone(event.from.x + (event.x - event.from.x) * progress,
          event.from.y + (event.y + 85 - event.from.y) * progress, 32)
        c.globalAlpha = Math.min(1, (1.2 - event.age) * 3)
        const y = event.y - (this.art.reducedMotion ? 0 : event.age * 30)
        this.box(event.x - 51, y - 24, 102, 46, '#fff5b7', 18)
        this.text('+$20', event.x, y, 30, '#12664e')
      }
      if (event.kind === 'build' || event.kind === 'hire' || event.kind === 'party') {
        c.globalAlpha = Math.min(1, (1.2 - event.age) * 3)
        for (let n = 0; n < 8; n++) {
          const angle = n * Math.PI / 4
          const radius = 40 + (this.art.reducedMotion ? 0 : event.age * 90)
          this.sprite(2, 3, event.x + Math.cos(angle) * radius - 12, event.y + Math.sin(angle) * radius - 12, 24, 24)
        }
      }
      c.restore()
    }
    if (joystick.active) {
      c.save(); c.strokeStyle = '#4a3b4570'; c.fillStyle = '#fffcf535'; c.lineWidth = 3
      c.beginPath(); c.arc(joystick.origin.x, joystick.origin.y, 52, 0, Math.PI * 2); c.fill(); c.stroke()
      const dx = joystick.current.x - joystick.origin.x, dy = joystick.current.y - joystick.origin.y
      const norm = Math.max(1, Math.hypot(dx, dy) / 45)
      c.beginPath(); c.arc(joystick.origin.x + dx / norm, joystick.origin.y + dy / norm, 23, 0, Math.PI * 2); c.fill(); c.stroke(); c.restore()
    }
  }

  private counter(x: number, y: number, active: boolean) {
    this.shadow(x, y - 28, 78)
    this.box(x - 75, y - 83, 150, 57, '#a2ddcb', 14)
    this.box(x - 80, y - 100, 160, 30, '#ffe3bc', 12)
    this.sprite(3, 2, x + 20, y - 147, 64, 59)
    this.cone(x - 32, y - 88, 28)
    this.ring(x, y, 60, active)
    this.text('SERVE', x, y + 44, 22)
  }

  private actor(actor: Walker, helper: boolean, time: number) {
    const c = this.ctx
    this.shadow(actor.x, actor.y + 2, 29)
    const frame = walkSheetFrame(actor.moving ? actor.distance : 0, actor.direction)
    const p = walkSheetPlacement(frame, 0, 0)
    if (this.art.playerWalkImage?.naturalWidth) {
      c.save(); c.translate(actor.x, actor.y)
      const breath = !actor.moving && !this.art.reducedMotion ? Math.sin(time * 2.4 + (helper ? 1 : 0)) * .008 : 0
      c.scale(frame.flipX ? -.66 : .66, .66 * (1 + breath))
      c.drawImage(this.art.playerWalkImage, p.sourceX, p.sourceY, p.sourceWidth, p.sourceHeight,
        p.destinationX, p.destinationY - 8.5, p.destinationWidth, p.destinationHeight)
      c.restore()
    } else this.sprite(0, 0, actor.x - 38, actor.y - 94, 76, 94)
    if (helper) {
      this.box(actor.x - 26, actor.y - 124, 52, 26, '#ffe393', 10)
      this.text('PIP', actor.x, actor.y - 110, 18)
    }
    if (actor.cones) {
      const sway = actor.moving && !this.art.reducedMotion ? Math.sin(actor.distance / 16) * 2 : 0
      const x = actor.x, y = actor.y - 28 + sway
      this.box(x - 37, y, 74, 12, '#ffe1a5', 6, '#9c765c')
      this.box(x - 42, y + 1, 9, 10, '#fff3dc', 3, '#9c765c')
      this.box(x + 33, y + 1, 9, 10, '#fff3dc', 3, '#9c765c')
      for (let n = 0; n < actor.cones; n++) this.cone(x - (actor.cones - 1) * 10 + n * 20, y - n * 3, 28)
    }
  }

  private partyTable(state: FloorState) {
    const { x, y } = FLOOR.counters[2]
    this.shadow(x, y - 26, 82)
    this.box(x - 55, y - 44, 16, 32, '#aa765d', 4)
    this.box(x + 39, y - 44, 16, 32, '#aa765d', 4)
    this.box(x - 85, y - 76, 170, 35, '#ef9eb0', 12)
    const served = state.save.partyServed ?? 0
    for (let n = 0; n < FLOOR.party.guests; n++) {
      const spot = x - 62 + n * 25
      this.box(spot - 9, y - 66, 18, 8, '#fff9e9', 4, '#d58da0')
      if (n < served) this.sprite(1, 3, spot - 10, y - 82, 20, 18)
    }
    this.ring(x, y, 60, state.player.cones > 0 && served < FLOOR.party.guests)
    this.text(`PARTY ${served}/${FLOOR.party.guests}`, x, y + 43, 22)
  }

  private doorway(x: number, y: number, open = true) {
    this.box(x - 28, y - 102, 56, 106, '#b98768', 18)
    this.box(x - 21, y - 94, 42, 97, open ? '#d8efcf' : '#ecd0a4', 13, '#986e55')
    this.box(x - 34, y - 2, 68, 12, '#fff2d5', 4, '#b69a79')
  }

  private room(state: FloorState) {
    const c = this.ctx
    // The walls, threshold and fenced courtyard stay in frame: expansion opens a place, not a menu.
    this.box(25, 82, 590, 830, '#a8cda2', 28, '#638b6a')
    this.box(32, 90, 576, 585, '#f9e8cc', 20, '#ba9f89')
    if (this.art.roomBackdrop.naturalWidth) c.drawImage(this.art.roomBackdrop, 536, 0, 720, 320, 34, 90, 572, 200)
    c.save(); c.beginPath(); c.rect(36, 290, 568, state.save.patio ? 610 : 382); c.clip()
    c.fillStyle = '#f5debb'; c.fillRect(36, 290, 568, 620)
    for (let row = 0; row < 11; row++) for (let col = 0; col < 10; col++) {
      const x = 36 + col * 60, y = 290 + row * 60
      c.fillStyle = (row + col) % 2 ? '#faecd8' : '#f5debb'; c.fillRect(x, y, 60, 60)
      c.strokeStyle = '#d1b89455'; c.lineWidth = 1; c.strokeRect(x, y, 60, 60)
    }
    c.restore()
    this.box(210, 112, 220, 63, '#4f776a', 18)
    this.text('SCOOPALOO', 320, 143, 29, '#fff8de')
    for (let i = 0; i < 12; i++) {
      c.fillStyle = i % 2 ? '#fff2d8' : '#eb92a9'
      c.fillRect(32 + i * 48, 185, 48, 28)
      c.beginPath(); c.arc(56 + i * 48, 213, 24, 0, Math.PI); c.fill()
    }
    this.doorway(FLOOR.entranceX, 315)
    this.doorway(FLOOR.staffDoor.x, FLOOR.staffDoor.y, state.save.helper)
    if (this.art.roomFloorProp.naturalWidth) {
      c.drawImage(this.art.roomFloorProp, 45, 504, 46, 64)
    }
    if (state.save.patio) {
      const build = state.events.find(e => e.kind === 'build')
      const reveal = build && !this.art.reducedMotion ? Math.min(1, build.age / .5) : 1
      c.save(); c.globalAlpha = reveal
      this.box(38, 675, 564, 12, '#9c765c', 3)
      this.doorway(FLOOR.entranceX, 730)
      if (!state.save.party) this.text('THE PATIO', 320, 723, 25, '#466957')
      for (const x of state.save.party ? [] : [265, 340]) {
        this.box(x - 12, 849, 24, 34, '#b98768', 6)
        this.shadow(x, 850, 32)
        this.box(x - 30, 820, 60, 30, '#ffe1a5', 16)
      }
      if (state.save.party) {
        // A real new service spot, not a multiplier: the player supplies six guests.
        c.strokeStyle = '#9c765c'; c.lineWidth = 2
        c.beginPath(); c.moveTo(200, 700); c.quadraticCurveTo(285, 740, 375, 700); c.stroke()
        for (let n = 0; n < 6; n++) {
          const x = 210 + n * 30, y = 707 + Math.sin(n / 5 * Math.PI) * 15
          c.fillStyle = n % 2 ? '#f7cf68' : '#eb92a9'
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + 19, y); c.lineTo(x + 9, y + 22); c.fill()
        }
      }
      c.restore()
    } else {
      this.text('ROOM TO GROW', 320, 780, 28, '#365b43')
      this.text('A patio. More customers.', 320, 820, 22, '#365b43')
      for (let x = 40; x < 605; x += 40) this.box(x, 666, 18, 56, '#ffebce', 6, '#b69a79')
      this.box(38, 683, 564, 12, '#ffe3bc', 4, '#b69a79')
    }
  }
}
