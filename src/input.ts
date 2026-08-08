import type { Input, Point } from './engine'
import { clientToWorld, type Viewport } from './viewport'

const MOVEMENT_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))
}

export class Controls {
  readonly vector: Input = { x: 0, y: 0 }
  readonly joystick = { active: false, origin: { x: 0, y: 0 }, current: { x: 0, y: 0 } }
  private keys = new Set<string>()
  private pointer: number | null = null

  constructor(private canvas: HTMLCanvasElement, private view: () => Viewport) {
    addEventListener('keydown', event => {
      const key = event.key.toLowerCase()
      if (event.metaKey || event.ctrlKey || event.altKey || !MOVEMENT_KEYS.has(key) || isEditable(event.target)) return
      this.keys.add(key)
      this.readKeys()
      event.preventDefault()
    })
    addEventListener('keyup', event => { this.keys.delete(event.key.toLowerCase()); this.readKeys() })
    addEventListener('blur', () => { this.keys.clear(); this.readKeys() })
    canvas.addEventListener('pointerdown', event => this.down(event))
    canvas.addEventListener('pointermove', event => this.move(event))
    canvas.addEventListener('pointerup', event => this.up(event))
    canvas.addEventListener('pointercancel', event => this.up(event))
  }

  private down(event: PointerEvent): void {
    if (this.pointer !== null) return
    this.pointer = event.pointerId
    this.canvas.setPointerCapture(event.pointerId)
    const point = this.toWorld(event)
    this.joystick.active = true
    this.joystick.origin = point
    this.joystick.current = point
  }

  private move(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return
    this.joystick.current = this.toWorld(event)
    const dx = this.joystick.current.x - this.joystick.origin.x
    const dy = this.joystick.current.y - this.joystick.origin.y
    const length = Math.max(55, Math.hypot(dx, dy))
    this.vector.x = dx / length
    this.vector.y = dy / length
  }

  private up(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return
    this.pointer = null
    this.joystick.active = false
    this.vector.x = 0
    this.vector.y = 0
    this.readKeys()
  }

  private readKeys(): void {
    if (this.pointer !== null) return
    const pressed = (...names: string[]) => names.some(name => this.keys.has(name))
    this.vector.x = Number(pressed('d', 'arrowright')) - Number(pressed('a', 'arrowleft'))
    this.vector.y = Number(pressed('s', 'arrowdown')) - Number(pressed('w', 'arrowup'))
  }

  private toWorld(event: PointerEvent): Point {
    // same viewport object the renderer draws through, so a live resize cannot
    // leave input and rendering with different ideas of where the world is (#13)
    const rect = this.canvas.getBoundingClientRect()
    return clientToWorld(this.view(), event.clientX - rect.left, event.clientY - rect.top)
  }
}
