import type { ShiftPhase } from './engine'

export type ShiftUiState = {
  phase: ShiftPhase
  day: string
  secondsRemaining: number
  revenue: number
  goal: number
  served: number
  missed: number
  streak: number
  bestStreak: number
  stars: number
  success: boolean
  order?: {
    x: number
    y: number
    label: string
    quantity: number
    price: number
    patience: number
    icon?: string
  } | null
}

type ShiftActions = { start: () => void; retry: () => void; next: () => void }

export class ShiftUi {
  private readonly fields: Record<string, HTMLElement>
  private previousPhase: ShiftPhase | null = null

  constructor(private readonly root: HTMLElement, actions: ShiftActions) {
    root.className = 'shift-ui'
    root.innerHTML = `
      <section class="shift-hud" aria-label="Shift status">
        <div class="hud-stat"><span>DAY</span><strong data-field="hud-day">1</strong></div>
        <div class="hud-stat hud-time"><span>TIME</span><strong data-field="time">1:30</strong></div>
        <div class="hud-stat hud-money"><span>EARNED</span><strong><b data-field="revenue">$0</b><small data-field="goal"> / $60</small></strong></div>
        <div class="hud-stat"><span>SERVED</span><strong data-field="served">0</strong></div>
        <div class="hud-stat"><span>MISSED</span><strong data-field="missed">0</strong></div>
        <div class="hud-stat"><span>STREAK</span><strong data-field="streak">0</strong></div>
      </section>

      <aside class="order-ticket" data-field="ticket" aria-label="Current order" hidden>
        <div class="ticket-heading"><span>ORDER</span><strong data-field="order-quantity">×1</strong></div>
        <div class="ticket-body">
          <img class="ticket-icon" data-field="order-icon" src="/assets/items/vanilla-cone.svg" alt="" />
          <strong data-field="order-label">VANILLA CONE</strong>
          <b data-field="order-price">$6</b>
        </div>
        <div class="patience-track" aria-label="Customer patience"><i data-field="patience"></i></div>
      </aside>

      <section class="shift-card ready-card" aria-labelledby="ready-title">
        <img src="/assets/brand/scoopaloo-logo.svg" alt="Scoopaloo" />
        <p class="card-kicker" data-field="ready-day">DAY 1</p>
        <h1 id="ready-title"><span data-field="ready-goal">$60</span> GOAL</h1>
        <p>SERVE FAST. COLLECT EVERY COIN.</p>
        <button type="button" data-action="start">START SHIFT</button>
      </section>

      <section class="shift-card results-card" aria-labelledby="results-title">
        <p class="card-kicker">DAY 1 RESULTS</p>
        <h1 id="results-title" data-field="result-title">SHIFT COMPLETE</h1>
        <div class="result-score"><strong data-field="result-revenue">$0</strong><span data-field="result-goal"> / $60 GOAL</span></div>
        <dl>
          <div><dt>SERVED</dt><dd data-field="result-served">0</dd></div>
          <div><dt>MISSED</dt><dd data-field="result-missed">0</dd></div>
          <div><dt>BEST STREAK</dt><dd data-field="result-streak">0</dd></div>
        </dl>
        <p class="result-stars" data-field="stars">STARS 0 / 3</p>
        <div class="card-actions">
          <button type="button" class="secondary" data-action="retry">RETRY</button>
          <button type="button" data-action="next">NEXT</button>
        </div>
      </section>`

    this.fields = Object.fromEntries(
      [...root.querySelectorAll<HTMLElement>('[data-field]')]
        .map(element => [element.dataset.field ?? '', element]),
    )
    root.querySelector<HTMLButtonElement>('[data-action="start"]')?.addEventListener('click', actions.start)
    root.querySelector<HTMLButtonElement>('[data-action="retry"]')?.addEventListener('click', actions.retry)
    root.querySelector<HTMLButtonElement>('[data-action="next"]')?.addEventListener('click', actions.next)
  }

  update(state: ShiftUiState): void {
    if (state.phase !== this.previousPhase) {
      this.root.dataset.phase = state.phase
      this.previousPhase = state.phase
    }

    const dayNumber = state.day.replace(/\D/g, '') || state.day
    this.set('hud-day', dayNumber)
    this.set('ready-day', state.day)
    this.set('time', clock(state.secondsRemaining))
    this.set('revenue', `$${state.revenue}`)
    this.set('goal', ` / $${state.goal}`)
    this.set('served', state.served)
    this.set('missed', state.missed)
    this.set('streak', state.streak)
    this.set('ready-goal', `$${state.goal}`)
    this.set('result-title', state.success ? 'SHIFT COMPLETE' : 'GOAL MISSED')
    this.set('result-revenue', `$${state.revenue}`)
    this.set('result-goal', ` / $${state.goal} GOAL`)
    this.set('result-served', state.served)
    this.set('result-missed', state.missed)
    this.set('result-streak', state.bestStreak)
    this.set('stars', `STARS ${state.stars} / 3`)

    const next = this.root.querySelector<HTMLButtonElement>('[data-action="next"]')
    if (next) next.disabled = !state.success

    const ticket = this.fields.ticket
    const showTicket = state.phase === 'playing' && Boolean(state.order)
    ticket.hidden = !showTicket
    if (!state.order) return
    this.set('order-label', state.order.label)
    this.set('order-quantity', `×${state.order.quantity}`)
    this.set('order-price', `$${state.order.price}`)
    const icon = this.fields['order-icon'] as HTMLImageElement
    if (state.order.icon && icon.getAttribute('src') !== state.order.icon) icon.src = state.order.icon
    const position = `translate3d(${Math.round(state.order.x)}px, ${Math.round(state.order.y)}px, 0)`
    if (ticket.style.transform !== position) ticket.style.transform = position
    this.fields.patience.style.width = `${Math.round(Math.max(0, Math.min(1, state.order.patience)) * 100)}%`
  }

  private set(field: string, value: string | number): void {
    const text = String(value)
    if (this.fields[field]?.textContent !== text) this.fields[field].textContent = text
  }
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
