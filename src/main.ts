import QRCode from 'qrcode'
import './style.css'
import {
  createGame,
  comboBonus,
  customerPatience,
  enterShop,
  goalMet,
  helperInterval,
  leaveShop,
  nextDay,
  purchaseUpgrade,
  prepSeconds,
  retryShift,
  runFor,
  startShift,
  step,
  tipFor,
  upgradeOffer,
  upcomingOrders,
  type Customer,
  type GameState,
  type Point,
} from './engine'
import { Controls } from './input'
import { Renderer } from './render'
import { loadSave, rescueUrl, storeSave } from './save'
import { ShiftUi, type UpgradeUiItem } from './shift-ui'
import type { GameSkin, SkinUpgrade } from './skin'
import skinData from './skins/ice-cream.json'
import { GameSound } from './sound'
import { backingSize, computeViewport, type Viewport } from './viewport'

declare global {
  interface Window {
    __scoopaloo: {
      snapshot: () => GameState
      movePlayer: (point: Point) => void
      advance: (seconds: number, input?: Point) => void
      viewport: () => Viewport
      joystickOrigin: () => Point | null
      pause: (on: boolean) => void
      setTime: (seconds: number) => void
      atlasReady: () => boolean
      startShift: () => void
      retryShift: () => void
    }
  }
}

const found = document.querySelector<HTMLCanvasElement>('#game')
if (!found) throw new Error('game canvas missing')
const canvas: HTMLCanvasElement = found

const skin = skinData as GameSkin
const state = createGame(skin, loadSave(skin))
const FIRST_SHIFT_COACH = 'DRAG ANYWHERE TO MOVE · WALK INTO DASHED INGREDIENT RINGS TO PICK UP'
const coachOrigin = { x: state.player.x, y: state.player.y }
let coachStep: 'move' | 'ring' | null = state.rules.kind === 'campaign'
  && state.rules.level === 1
  && state.save.currentDay === 0
  && state.save.scoreChaseLevel === 0
  && state.save.lifetimeCash === 0
  && state.save.dayBestRevenue[0] === 0
  ? 'move' : null
let previousScoreChaseBest = state.save.scoreChaseBest
const sound = new GameSound()
canvas.addEventListener('pointerdown', () => sound.unlock(), { passive: true })
canvas.addEventListener('keydown', () => sound.unlock())

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
const shiftRoot = document.querySelector<HTMLElement>('#shift-ui')
if (!shiftRoot) throw new Error('shift UI missing')
const shiftUi = new ShiftUi(shiftRoot, {
  start: () => {
    sound.unlock()
    previousScoreChaseBest = state.save.scoreChaseBest
    startShift(state)
    sound.play('start')
  },
  retry: () => {
    sound.unlock()
    if (retryShift(state)) {
      previousScoreChaseBest = state.save.scoreChaseBest
      sound.play('start')
      storeSave(state.save)
    }
  },
  shop: () => { enterShop(state) },
  back: () => { leaveShop(state) },
  next: () => {
    sound.unlock()
    if (nextDay(state)) {
      previousScoreChaseBest = state.save.scoreChaseBest
      sound.play('next')
      storeSave(state.save)
    }
  },
  buy: id => {
    sound.unlock()
    if (purchaseUpgrade(state, id)) {
      sound.play('buy')
      storeSave(state.save)
    }
  },
})
canvas.setAttribute('aria-label', 'Scoopaloo ice cream stand game. Drag anywhere to move, or use W A S D or arrow keys. Walk into dashed ingredient rings to pick up ingredients automatically. Hold at prep until complete.')
canvas.setAttribute('aria-describedby', 'helper-status')
let previous = performance.now()
let saveClock = 0
let previousSoundPhase = state.phase
const heardEvents = new WeakSet<object>()
const hurriedCustomers = new WeakSet<Customer>()
let hurriedCustomer: Customer | undefined
let hurrySerial = 0
const HURRY_SECONDS = 10

// paused = deterministic evidence mode (#14): the loop keeps RENDERING so
// captures show the live scene, but the engine only steps via the advance hook
let paused = false

function frame(now: number): void {
  const elapsed = Math.min(.05, (now - previous) / 1000)
  previous = now
  const coachingFrame = !paused && state.phase === 'playing'
  if (!paused) step(state, elapsed, controls.vector)
  if (coachingFrame && coachStep === 'move'
    && Math.hypot(state.player.x - coachOrigin.x, state.player.y - coachOrigin.y) >= 24) coachStep = 'ring'
  if (coachingFrame && coachStep === 'ring'
    && state.events.some(event => event.kind === 'pickup' && event.source)) coachStep = null
  updateSound()
  renderer.draw(state, controls.joystick, viewport)
  updateShiftUi()
  saveClock += elapsed
  if (saveClock >= 1) {
    saveClock = 0
    storeSave(state.save)
  }
  requestAnimationFrame(frame)
}

function updateSound(): void {
  if (state.phase !== previousSoundPhase) {
    if (state.phase === 'results') sound.play(goalMet(state) ? 'success' : 'fail')
    previousSoundPhase = state.phase
  }
  for (const event of state.events) {
    if (heardEvents.has(event)) continue
    heardEvents.add(event)
    const reachedComboTier = event.kind === 'pay'
      && skin.comboTiers.some(tier => tier.streak === event.streak)
    sound.play(event.kind === 'reject' && event.reason !== 'wrong-item' ? 'blocked'
      : reachedComboTier ? 'combo' : event.kind)
  }
  const front = state.customers.find(customer => !customer.served && !customer.missed)
  if (state.phase === 'playing' && front && front.patience > 0
    && front.patience <= HURRY_SECONDS && !hurriedCustomers.has(front)) {
    hurriedCustomers.add(front)
    hurriedCustomer = front
    hurrySerial++
    sound.play('hurry')
  }
}

function serviceStake(customer: Customer): { tip: number; combo: number; payout: number } {
  const tip = tipFor(customer.patience, customerPatience(state))
  const combo = comboBonus(state, state.shift.streak + 1)
  return { tip, combo, payout: customer.order.price + tip + combo }
}

function updateShiftUi(): void {
  const rules = state.rules
  const helperSeconds = helperInterval(state)
  const waitingCustomers = state.customers.filter(customer => !customer.served && !customer.missed)
  const front = waitingCustomers[0]
  const rejection = [...state.events].reverse().find(event => event.kind === 'reject')
  const nextComboTier = skin.comboTiers.find(tier => tier.streak > state.shift.streak)
  const comboFeedback = [...state.events].reverse().find(event => event.kind === 'combo-break'
    || (event.kind === 'pay' && skin.comboTiers.some(tier => tier.streak === event.streak)))
  let order = null
  let recipe = null
  if (front) {
    const stake = serviceStake(front)
    order = {
      label: front.order.label,
      quantity: front.order.quantity,
      price: front.order.price,
      patience: front.patience / customerPatience(state),
      patienceSeconds: Math.max(0, Math.ceil(front.patience)),
      patienceMax: Math.ceil(customerPatience(state)),
      tip: stake.tip,
      potentialCombo: stake.combo,
      potentialPayout: stake.payout,
      urgent: front.patience > 0 && front.patience <= HURRY_SECONDS,
      icon: front.order.icon,
    }
    const definition = skin.items[front.order.item]
    const itemRecipe = definition.recipe
    if (itemRecipe) {
      const prep = state.prepStations[itemRecipe.station]
      const working = prep?.job?.item === front.order.item
      const ready = (prep?.outputs[front.order.item] ?? 0) > 0
      const carrying = (state.player.trayItems[front.order.item] ?? 0) > 0
      const progress = working && prep.job
        ? 1 - prep.job.remaining / prepSeconds(state, front.order.item)
        : null
      const steps = Object.entries(itemRecipe.inputs).map(([item, need]) => ({
        label: skin.items[item].label,
        icon: skin.items[item].icon,
        have: working || ready || carrying ? need : state.player.trayItems[item] ?? 0,
        need,
      }))
      const missing = steps.filter(step => step.have < step.need).map(step => step.label)
      recipe = {
        instruction: coachStep === 'move' ? 'DRAG ANYWHERE TO MOVE'
          : coachStep === 'ring' ? 'WALK\u202fINTO\u202fINGREDIENT\u202fRING'
            : carrying ? 'DELIVER TO COUNTER'
              : ready ? 'READY AT PREP'
                : working ? prep.job?.assisted && progress === 0
                  ? `${skin.helper?.name ?? 'HELPER'} READY · HOLD AT PREP`
                  : `MAKING ${front.order.label}`
                  : missing.length ? `GET ${missing.join(' + ')}` : 'HOLD AT PREP',
        progress,
        steps,
      }
    }
  }
  shiftUi.update({
    phase: state.phase,
    day: rules.kind === 'score-chase' ? `${rules.label} ${rules.level}` : rules.label,
    challenge: rules.challenge,
    readyBanner: coachStep && rules.kind === 'campaign' && rules.level === 1
      ? FIRST_SHIFT_COACH
      : rules.kind === 'score-chase'
        ? rules.level === 1 ? state.skin.days.at(-1)?.unlockBanner : `RUSH ${rules.level} UNLOCKED`
        : state.save.currentDay > 0 ? state.skin.days[state.save.currentDay - 1]?.unlockBanner : '',
    resultBanner: goalMet(state) ? rules.unlockBanner : '',
    rush: rules.kind === 'score-chase' ? {
      level: rules.level,
      best: state.save.scoreChaseBest,
      previousBest: previousScoreChaseBest,
      arrivalSeconds: rules.spawnInterval,
      patienceSeconds: customerPatience(state),
    } : undefined,
    secondsRemaining: state.shift.remaining,
    revenue: state.shift.revenue,
    goal: rules.cashGoal,
    served: state.shift.served,
    missed: state.shift.missed,
    streak: state.shift.streak,
    comboBonus: comboBonus(state, state.shift.streak),
    comboNextAt: nextComboTier?.streak,
    comboEvent: comboFeedback ? {
      serial: Math.round((state.time - comboFeedback.age) * 1000),
      kind: comboFeedback.kind === 'combo-break' ? 'break' : 'gain',
      streak: comboFeedback.streak ?? 0,
    } : undefined,
    urgentEvent: front && hurriedCustomer === front ? { serial: hurrySerial } : undefined,
    bestStreak: state.shift.bestStreak,
    stars: state.shift.stars,
    success: goalMet(state),
    cash: state.save.coins,
    canAdvance: goalMet(state),
    finalDay: rules.kind === 'campaign' && rules.level === state.skin.days.length,
    canStartScoreChase: rules.kind === 'campaign'
      && rules.level === state.skin.days.length && Boolean(state.skin.scoreChase),
    upgrades: skin.upgrades.map(upgrade => upgradeUi(upgrade, rules.customerPatience)),
    helper: skin.helper ? {
      name: skin.helper.name,
      remaining: state.helper.remaining,
      enabled: helperSeconds !== null,
    } : undefined,
    warning: rejection?.reason === 'returned-raw' ? 'EXTRA RETURNED TO SOURCE'
      : rejection?.reason === 'needs-prep' ? 'FINISH IT AT PREP'
        : rejection ? 'WRONG ITEM' : '',
    recipe,
    trayItems: inventoryUi(state.player.trayItems),
    counterItems: inventoryUi(state.counter.items),
    upcomingOrders: upcomingOrders(state, 2).map((upcoming, index) => ({
      label: upcoming.label,
      icon: upcoming.icon,
      quantity: upcoming.quantity,
      actionable: Boolean(waitingCustomers[index + 1]) && index + 1 < rules.activeOrderWindow,
      patience: waitingCustomers[index + 1]
        ? waitingCustomers[index + 1].patience / customerPatience(state)
        : null,
      seconds: waitingCustomers[index + 1]
        ? Math.max(0, Math.ceil(waitingCustomers[index + 1].patience))
        : null,
    })),
    order,
  })
}

function upgradeUi(upgrade: SkinUpgrade, basePatience: number): UpgradeUiItem {
  const offer = upgradeOffer(state, upgrade)
  const display = (bonus: number): string => {
    const value = upgrade.kind === 'walkSpeed' ? 185 + bonus
      : upgrade.kind === 'trayCapacity' ? 2 + bonus
        : upgrade.kind === 'customerPatience' ? basePatience + bonus
          : bonus
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  }
  return {
    id: upgrade.id,
    name: upgrade.name,
    level: offer.level,
    maxLevel: upgrade.levels.length,
    price: offer.price,
    before: display(offer.before),
    after: display(offer.after),
    stat: upgrade.unit,
    affordable: offer.affordable,
    capped: offer.capped,
    helper: skin.helper?.upgradeId === upgrade.id
      ? { name: skin.helper.name, image: skin.helper.image }
      : undefined,
  }
}

function inventoryUi(inventory: Record<string, number>): { label: string; icon: string; count: number }[] {
  return Object.entries(inventory)
    .filter(([, count]) => count > 0)
    .map(([item, count]) => ({ label: skin.items[item].label, icon: skin.items[item].icon, count }))
}

requestAnimationFrame(frame)
addEventListener('pagehide', () => storeSave(state.save))

const dialog = document.querySelector<HTMLDialogElement>('#save-dialog')
const saveButton = document.querySelector<HTMLButtonElement>('#save-button')
const soundButton = document.querySelector<HTMLButtonElement>('#sound-button')
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

if (soundButton) {
  const updateButton = () => {
    soundButton.ariaPressed = String(sound.enabled())
    soundButton.title = sound.enabled() ? 'Mute sound' : 'Turn sound on'
  }
  soundButton.addEventListener('click', () => {
    const enabled = sound.toggle()
    updateButton()
    if (enabled) sound.play('pickup')
  })
  updateButton()
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}

// The update toast (#19): navigations are network-first (#18), so a reload IS
// the update. This just tells a mid-session player one is waiting: probe the
// served shell, compare against the shell we booted from, and show a wordless
// refresh pill when they differ. Tap = reload. Probes ride visibility changes
// (the natural "came back to the game" moment) plus a slow interval.
const updateToast = document.querySelector<HTMLButtonElement>('#update-toast')
if (import.meta.env.PROD && updateToast) {
  let baseline: string | null = null
  const probe = async (): Promise<void> => {
    try {
      const response = await fetch('/?update-probe', { cache: 'no-store' })
      if (!response.ok) return
      const text = await response.text()
      if (baseline === null) baseline = text
      else if (text !== baseline) updateToast.hidden = false
    } catch { /* offline: nothing to say */ }
  }
  updateToast.addEventListener('click', () => location.reload())
  probe()
  setInterval(probe, 5 * 60 * 1000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void probe() })
}

if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
  window.__scoopaloo = {
    snapshot: () => structuredClone(state),
    movePlayer: point => { state.player.x = point.x; state.player.y = point.y },
    advance: (seconds, input) => runFor(state, seconds, input),
    viewport: () => ({ ...viewport }),
    joystickOrigin: () => (controls.joystick.active ? { ...controls.joystick.origin } : null),
    pause: on => { paused = on },
    // fixed-time control (#14): the display clock drives dash offsets and idle
    // wiggles, so deterministic captures pin it to a chosen instant
    setTime: seconds => { state.time = seconds },
    atlasReady: () => renderer.assetsReady(),
    startShift: () => {
      previousScoreChaseBest = state.save.scoreChaseBest
      startShift(state)
    },
    retryShift: () => {
      if (retryShift(state)) previousScoreChaseBest = state.save.scoreChaseBest
    },
  }
}
