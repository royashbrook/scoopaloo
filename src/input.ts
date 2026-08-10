import type { Input, Point } from './engine'
import { clientToWorld, type Viewport } from './viewport'

const MOVEMENT_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])

export function dragVector(origin: Point, current: Point): Input {
  const dx = current.x - origin.x
  const dy = current.y - origin.y
  const length = Math.max(55, Math.hypot(dx, dy))
  return { x: dx / length, y: dy / length }
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))
}

export class Controls {
  readonly vector: Input = { x: 0, y: 0 }
  readonly joystick: { readonly active: boolean; readonly origin: Point; readonly current: Point }
  private joystickCss = { active: false, origin: { x: 0, y: 0 }, current: { x: 0, y: 0 } }
  private keys = new Set<string>()
  private pointer: number | null = null

  constructor(private canvas: HTMLCanvasElement, private view: () => Viewport) {
    const controls = this
    this.joystick = {
      get active() { return controls.joystickCss.active },
      get origin() { return controls.toWorld(controls.joystickCss.origin) },
      get current() { return controls.toWorld(controls.joystickCss.current) },
    }
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
    const point = this.toCss(event)
    this.joystickCss.active = true
    this.joystickCss.origin = point
    this.joystickCss.current = point
  }

  private move(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return
    this.joystickCss.current = this.toCss(event)
    Object.assign(this.vector, dragVector(this.joystickCss.origin, this.joystickCss.current))
  }

  private up(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return
    this.pointer = null
    this.joystickCss.active = false
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

  private toCss(event: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  private toWorld(point: Point): Point {
    // Keep held touch points screen-anchored while the shared camera pans.
    return clientToWorld(this.view(), point.x, point.y)
  }
}
