import QRCode from 'qrcode'
import './style.css'
import { createGame, runFor, step, type GameState, type Point } from './engine'
import { Controls } from './input'
import { Renderer } from './render'
import { loadSave, rescueUrl, storeSave } from './save'

declare global {
  interface Window {
    __scoopaloo: {
      snapshot: () => GameState
      movePlayer: (point: Point) => void
      advance: (seconds: number) => void
    }
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) throw new Error('game canvas missing')

const state = createGame(loadSave())
const controls = new Controls(canvas)
const renderer = new Renderer(canvas)
let previous = performance.now()
let saveClock = 0

function frame(now: number): void {
  const elapsed = Math.min(.05, (now - previous) / 1000)
  previous = now
  step(state, elapsed, controls.vector)
  renderer.draw(state, controls.joystick)
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
  advance: seconds => runFor(state, seconds),
}
