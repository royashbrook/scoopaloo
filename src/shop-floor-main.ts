import './shop-floor.css'
import { Controls } from './input'
import { createFloor, floorHint, floorStorage, FLOOR, stepFloor } from './shop-floor'
import { FloorRenderer } from './shop-floor-render'
import { GameSound } from './sound'
import skinData from './skins/ice-cream.json'
import type { GameSkin } from './skin'
import { backingSize, type Viewport } from './viewport'

const canvas = document.querySelector<HTMLCanvasElement>('#floor')!
const pause = document.querySelector<HTMLDialogElement>('#pause-dialog')!
const about = document.querySelector<HTMLDialogElement>('#about-dialog')!
const storage = floorStorage()
const state = createFloor(storage.load())
const sound = new GameSound()
const renderer = new FloorRenderer(canvas, skinData as GameSkin)
const hint = document.querySelector<HTMLElement>('#hint')!
const cash = document.querySelector<HTMLElement>('#cash')!
const milestone = document.querySelector<HTMLElement>('#milestone')!
const warning = document.querySelector<HTMLElement>('#storage-warning')!
const resume = document.querySelector<HTMLButtonElement>('#resume')!
let ready = false
let view: Viewport

function resize() {
  const width = canvas.clientWidth, height = canvas.clientHeight
  const safe = getComputedStyle(document.querySelector('.floor-hud')!)
  const top = Math.max(64, parseFloat(safe.top) + 54)
  // A phone frames the playable aisle, not the shop's outside walls. This keeps
  // characters large and the entire pickup / serve / expansion route in view.
  const frameWidth = width < 600 && height > width * 1.4 ? 480 : FLOOR.width
  const scale = Math.min(width / frameWidth, Math.max(1, height - top - 70) / (FLOOR.height - 70))
  view = { cssWidth: width, cssHeight: height, scale, dpr: Math.min(2, devicePixelRatio),
    viewWidth: width / scale, viewHeight: height / scale,
    originX: (FLOOR.width - width / scale) / 2, originY: 70 - top / scale }
  const size = backingSize(view)
  canvas.width = size.width; canvas.height = size.height
}
resize()
addEventListener('resize', resize)
new ResizeObserver(resize).observe(canvas)
const controls = new Controls(canvas, () => view)
const heard = new WeakSet<object>()
function persist() { warning.hidden = storage.store(state.save) }
function pauseShop() {
  state.paused = true
  controls.reset()
  persist()
  if (!pause.open) pause.showModal()
}
document.querySelector('#pause')!.addEventListener('click', pauseShop)
resume.addEventListener('click', () => {
  if (document.hidden) return
  controls.reset(); pause.close(); state.paused = false; sound.unlock(); canvas.focus()
})
pause.addEventListener('cancel', event => { event.preventDefault(); resume.click() })
document.querySelector('#about')!.addEventListener('click', () => about.showModal())
document.querySelector('#close-about')!.addEventListener('click', () => about.close())
const soundButton = document.querySelector<HTMLButtonElement>('#sound')!
function soundLabel() {
  soundButton.textContent = sound.enabled() ? 'SOUND ON' : 'SOUND OFF'
  soundButton.ariaPressed = String(sound.enabled())
}
soundButton.addEventListener('click', () => { sound.toggle(); soundLabel() })
soundLabel()
canvas.addEventListener('pointerdown', () => sound.unlock(), { passive: true })
canvas.addEventListener('keydown', () => sound.unlock())
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseShop() })
addEventListener('blur', pauseShop)
addEventListener('pagehide', () => { state.paused = true; persist() })
addEventListener('pageshow', event => { if (event.persisted) pauseShop() })
addEventListener('keydown', event => { if (event.key === 'Escape' && !pause.open) pauseShop() })
void renderer.art.ready.then(() => { ready = true; persist() })
let previous = performance.now(), saveClock = 0
function frame(now: number) {
  const dt = Math.min(.05, (now - previous) / 1000)
  previous = now
  if (ready && !document.hidden) stepFloor(state, dt, controls.vector)
  for (const event of state.events) if (!heard.has(event)) {
    heard.add(event)
    sound.play(event.kind === 'build' || event.kind === 'hire' ? 'buy' : event.kind)
    if (event.kind !== 'pickup') persist()
  }
  renderer.draw(state, view, controls.joystick)
  const message = ready ? floorHint(state) : 'Loading your shop…'
  if (hint.textContent !== message) hint.textContent = message
  cash.textContent = String(state.save.cash)
  milestone.textContent = state.save.helper ? 'A TEAM OF TWO' : state.save.patio ? 'PATIO OPEN!' : 'YOUR LITTLE SHOP'
  saveClock += dt
  if (saveClock >= 1) { saveClock = 0; persist() }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// Test builds expose read-only state. Play proofs still use the real movement controls.
if (import.meta.env.MODE === 'test') Object.assign(window, { __shopFloor: { snapshot: () => structuredClone(state) } })
