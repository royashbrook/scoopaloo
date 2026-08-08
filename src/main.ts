import QRCode from 'qrcode'
import './style.css'
import { createGame, runFor, step, type GameState, type Point } from './engine'
import { Controls } from './input'
import { Renderer } from './render'
import { loadSave, rescueUrl, storeSave } from './save'
import type { GameSkin } from './skin'
import skinData from './skins/ice-cream.json'
import { backingSize, computeViewport, type Viewport } from './viewport'

declare global {
  interface Window {
    __scoopaloo: {
      snapshot: () => GameState
      movePlayer: (point: Point) => void
      advance: (seconds: number, input?: Point) => void
      viewport: () => Viewport
      joystickOrigin: () => Point | null
    }
  }
}

const found = document.querySelector<HTMLCanvasElement>('#game')
if (!found) throw new Error('game canvas missing')
const canvas: HTMLCanvasElement = found

const skin = skinData as GameSkin
const state = createGame(skin, loadSave(skin))

// The one current viewport (#13): rendering and input both read this object and
// nothing else, so a resize cannot leave the two disagreeing about the world.
let viewport = computeViewport(innerWidth, innerHeight, devicePixelRatio)
function fitViewport(): void {
  viewport = computeViewport(innerWidth, innerHeight, devicePixelRatio)
  const backing = backingSize(viewport)
  if (canvas.width !== backing.width) canvas.width = backing.width
  if (canvas.height !== backing.height) canvas.height = backing.height
}
fitViewport()
addEventListener('resize', fitViewport)
new ResizeObserver(fitViewport).observe(document.body)

const controls = new Controls(canvas, () => viewport)
const renderer = new Renderer(canvas, skin)
let previous = performance.now()
let saveClock = 0

function frame(now: number): void {
  const elapsed = Math.min(.05, (now - previous) / 1000)
  previous = now
  step(state, elapsed, controls.vector)
  renderer.draw(state, controls.joystick, viewport)
  saveClock += elapsed
  if (saveClock >= 1) {
    saveClock = 0
    storeSave(state.save)
  }
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
addEventListener('pagehide', () => storeSave(state.save))

const dialog = document.querySelector<HTMLDialogElement>('#save-dialog')
const saveButton = document.querySelector<HTMLButtonElement>('#save-button')
const qr = document.querySelector<HTMLImageElement>('#save-qr')
const link = document.querySelector<HTMLAnchorElement>('#rescue-link')
if (dialog && saveButton && qr && link) {
  saveButton.addEventListener('click', async () => {
    storeSave(state.save)
    const url = await rescueUrl(state.save)
    qr.src = await QRCode.toDataURL(url, { width: 512, margin: 2, color: { dark: '#4A3B45', light: '#FFF3E6' } })
    link.href = url
    dialog.showModal()
  })
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}

window.__scoopaloo = {
  snapshot: () => structuredClone(state),
  movePlayer: point => { state.player.x = point.x; state.player.y = point.y },
  advance: (seconds, input) => runFor(state, seconds, input),
  viewport: () => ({ ...viewport }),
  joystickOrigin: () => (controls.joystick.active ? { ...controls.joystick.origin } : null),
}
