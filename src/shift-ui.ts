import type { ShiftPhase } from './engine'

export type ShiftUiState = {
  phase: ShiftPhase
  day: string
  challenge?: string
  readyBanner?: string
  resultBanner?: string
  rush?: {
    level: number
    best: number
    previousBest: number
    arrivalSeconds: number
    patienceSeconds: number
  }
  secondsRemaining: number
  revenue: number
  goal: number
  served: number
  missed: number
  streak: number
  comboBonus?: number
  comboNextAt?: number
  comboEvent?: { serial: number; kind: 'gain' | 'break'; streak: number }
  urgentEvent?: { serial: number }
  bestStreak: number
  stars: number
  success: boolean
  cash?: number
  canAdvance?: boolean
  finalDay?: boolean
  canStartScoreChase?: boolean
  upgrades?: UpgradeUiItem[]
  helper?: { name: string; remaining: number; enabled: boolean }
  wrongItem?: boolean
  warning?: string
  recipe?: {
    instruction: string
    progress?: number | null
    steps: { label: string; icon: string; have: number; need: number }[]
  } | null
  trayItems?: InventoryUiItem[]
  counterItems?: InventoryUiItem[]
  upcomingOrders?: UpcomingOrderUiItem[]
  order?: {
    label: string
    quantity: number
    price: number
    patience: number
    patienceSeconds: number
    patienceMax: number
    tip: number
    potentialCombo: number
    potentialPayout: number
    urgent: boolean
    icon?: string
  } | null
}

type InventoryUiItem = { label: string; icon: string; count: number }
export type UpcomingOrderUiItem = {
  label: string
  icon: string
  quantity: number
  actionable: boolean
  patience?: number | null
  seconds?: number | null
}
export type UpgradeUiItem = {
  id: string
  name: string
  level: number
  maxLevel: number
  price: number | null
  before: string
  after: string
  stat: string
  affordable: boolean
  capped: boolean
  helper?: { name: string; image: string }
}

type ShiftActions = {
  start: () => void
  retry: () => void
  shop: () => void
  back: () => void
  next: () => void
  buy: (id: string) => void
}

export class ShiftUi {
  private readonly fields: Record<string, HTMLElement>
  private previousPhase: ShiftPhase | null = null
  private previousComboEvent = -1
  private previousUrgentEvent = -1
  private comboTimer?: number

  constructor(private readonly root: HTMLElement, actions: ShiftActions) {
    root.className = 'shift-ui'
    root.innerHTML = `
      <p class="sr-only" id="helper-status" data-field="helper-status"></p>
      <section class="shift-hud" aria-label="Shift status">
        <div class="hud-stat"><span data-field="hud-mode">DAY</span><strong><b data-field="hud-day">1</b><small class="hud-rule" data-field="hud-best" hidden></small></strong></div>
        <div class="hud-stat hud-time"><span data-field="hud-time-label">TIME</span><strong><b data-field="time">1:30</b><small class="hud-rule" data-field="hud-arrival" hidden></small></strong></div>
        <div class="hud-stat hud-money"><span data-field="hud-earned-label">EARNED</span><strong><b data-field="revenue">$0</b><small data-field="goal"> / $60</small></strong></div>
        <div class="hud-stat"><span data-field="hud-served-label">SERVED</span><strong><b data-field="served">0</b><small class="hud-rule" data-field="hud-patience" hidden></small></strong></div>
        <div class="hud-stat"><span>MISSED</span><strong data-field="missed">0</strong></div>
        <div class="hud-stat hud-combo" data-field="combo-card">
          <span>COMBO</span>
          <strong class="combo-score"><b data-field="streak">0</b><small data-field="combo-tier" hidden></small></strong>
          <span class="sr-only" data-field="combo-status" role="status" aria-live="polite" aria-atomic="true">Combo 0.</span>
        </div>
      </section>

      <div class="order-panel" data-field="order-panel" hidden>
        <aside class="next-orders is-empty" aria-label="Upcoming orders" aria-hidden="true">
          <span class="next-heading" aria-hidden="true">NEXT</span>
          <ol data-field="upcoming-orders"></ol>
        </aside>
        <aside class="order-ticket" data-field="ticket" aria-label="Current order">
          <div class="ticket-heading">
            <span>ORDER</span>
            <strong data-field="order-quantity">×1</strong>
            <b data-field="order-payout">MAX $9</b>
          </div>
          <div class="ticket-body">
            <img class="ticket-icon" data-field="order-icon" src="/assets/items/vanilla-cone.svg" alt="" />
            <strong data-field="order-label">VANILLA CONE</strong>
            <b data-field="order-price">$6</b>
          </div>
          <div class="patience-track" data-field="patience-track" role="progressbar" aria-label="Customer patience" aria-valuemin="0">
            <i data-field="patience" aria-hidden="true"></i>
            <span class="patience-values" aria-hidden="true">
              <b data-field="patience-seconds">50s</b>
              <b data-field="tip-value">TIP +$3</b>
              <b data-field="projected-combo">COMBO +$0</b>
            </span>
          </div>
          <span class="sr-only" data-field="urgent-status" role="status" aria-live="polite" aria-atomic="true"></span>
          <div class="ticket-guidance">
            <span data-field="ticket-guidance" role="status" aria-live="polite" aria-atomic="true">GET THE INGREDIENTS</span>
            <i class="prep-progress" data-field="prep-progress" role="progressbar" aria-label="Preparation progress" aria-valuemin="0" aria-valuemax="100" hidden></i>
          </div>
          <ol class="recipe-list" data-field="recipe-list" aria-label="Recipe"></ol>
          <div class="inventory-readout">
            <div><span>TRAY</span><div data-inventory="tray"></div></div>
            <div><span>COUNTER</span><div data-inventory="counter"></div></div>
          </div>
        </aside>
      </div>

      <section class="shift-card ready-card" aria-labelledby="ready-title">
        <img src="/assets/brand/scoopaloo-logo.svg" alt="Scoopaloo" />
        <p class="card-kicker" data-field="ready-day">DAY 1</p>
        <h1 id="ready-title"><span data-field="ready-goal">$60</span> GOAL</h1>
        <p data-field="ready-challenge">SERVE FAST. COLLECT EVERY COIN.</p>
        <div class="rush-rules" data-field="ready-rush-rules" aria-label="Score chase rules" hidden>
          <span><b>GOAL</b><strong data-field="ready-rush-goal"></strong></span>
          <span><b>BEST</b><strong data-field="ready-rush-best"></strong></span>
          <span><b>ARRIVALS</b><strong data-field="ready-rush-arrival"></strong></span>
          <span><b>PATIENCE</b><strong data-field="ready-rush-patience"></strong></span>
        </div>
        <p class="unlock-banner" data-field="ready-unlock"></p>
        <button type="button" data-action="start" data-field="start">START SHIFT</button>
      </section>

      <section class="shift-card results-card" aria-labelledby="results-title">
        <p class="card-kicker" data-field="results-day">DAY 1 RESULTS</p>
        <h1 id="results-title" data-field="result-title">SHIFT COMPLETE</h1>
        <div class="result-score"><strong data-field="result-revenue">$0</strong><span data-field="result-goal"> / $60 GOAL</span></div>
        <div class="rush-rules" data-field="result-rush-rules" aria-label="Score chase rules" hidden>
          <span><b>GOAL</b><strong data-field="result-rush-goal"></strong></span>
          <span><b>BEST</b><strong data-field="result-rush-best"></strong></span>
          <span><b>ARRIVALS</b><strong data-field="result-rush-arrival"></strong></span>
          <span><b>PATIENCE</b><strong data-field="result-rush-patience"></strong></span>
        </div>
        <dl>
          <div><dt>SERVED</dt><dd data-field="result-served">0</dd></div>
          <div><dt>MISSED</dt><dd data-field="result-missed">0</dd></div>
          <div><dt>BEST STREAK</dt><dd data-field="result-streak">0</dd></div>
        </dl>
        <p class="result-stars" data-field="stars">STARS 0 / 3</p>
        <p class="rush-best" data-field="result-best" role="status" hidden></p>
        <p class="unlock-banner" data-field="result-unlock" role="status"></p>
        <div class="card-actions">
          <button type="button" class="secondary" data-action="retry" data-field="result-retry">RETRY</button>
          <button type="button" class="secondary" data-action="shop">UPGRADES</button>
        </div>
      </section>

      <dialog class="shop-card" aria-labelledby="shop-title">
        <header class="shop-heading">
          <div>
            <p class="card-kicker" data-field="shop-day">GEAR FOR DAY 1</p>
            <h1 id="shop-title" tabindex="-1">UPGRADE SHOP</h1>
          </div>
          <div class="shop-wallet"><span>CASH</span><strong data-field="cash">$0</strong></div>
        </header>
        <div class="rush-rules" data-field="shop-rush-rules" aria-label="Score chase rules" hidden>
          <span><b>GOAL</b><strong data-field="shop-rush-goal"></strong></span>
          <span><b>BEST</b><strong data-field="shop-rush-best"></strong></span>
          <span><b>ARRIVALS</b><strong data-field="shop-rush-arrival"></strong></span>
          <span><b>PATIENCE</b><strong data-field="shop-rush-patience"></strong></span>
        </div>
        <div class="upgrade-grid" data-field="upgrades" aria-label="Available upgrades"></div>
        <p class="purchase-status" data-field="purchase-status" role="status" aria-live="polite"></p>
        <div class="card-actions shop-actions">
          <button type="button" class="secondary" data-action="back">RESULTS</button>
          <button type="button" class="secondary" data-action="retry" data-field="shop-retry">RETRY DAY</button>
          <button type="button" data-action="next" data-field="shop-next">NEXT DAY</button>
        </div>
      </dialog>`

    this.fields = Object.fromEntries(
      [...root.querySelectorAll<HTMLElement>('[data-field]')]
        .map(element => [element.dataset.field ?? '', element]),
    )
    const on = (name: string, action: () => void) => root.querySelectorAll<HTMLButtonElement>(`[data-action="${name}"]`)
      .forEach(button => button.addEventListener('click', action))
    on('start', actions.start)
    on('retry', actions.retry)
    on('shop', actions.shop)
    on('back', actions.back)
    on('next', actions.next)
    root.querySelector<HTMLDialogElement>('.shop-card')?.addEventListener('cancel', event => {
      event.preventDefault()
      actions.back()
    })
    root.addEventListener('click', event => {
      if (!(event.target instanceof Element)) return
      const button = event.target.closest<HTMLButtonElement>('[data-upgrade]')
      if (button?.dataset.upgrade) {
        const card = button.closest<HTMLElement>('[data-upgrade-card]')
        const name = card?.querySelector('h2')?.textContent
        actions.buy(button.dataset.upgrade)
        this.set('purchase-status', card?.dataset.purchaseMessage ?? `${name ?? 'Upgrade'} purchased`)
      }
    })
  }

  update(state: ShiftUiState): void {
    if (state.phase !== this.previousPhase) {
      this.root.dataset.phase = state.phase
      if (state.phase === 'playing') {
        this.previousComboEvent = -1
        this.previousUrgentEvent = -1
        this.set('urgent-status', '')
        if (this.comboTimer != null) window.clearTimeout(this.comboTimer)
        this.comboTimer = undefined
        this.fields['combo-card'].classList.remove('is-gain', 'is-break')
      }
      const shop = this.root.querySelector<HTMLDialogElement>('.shop-card')
      if (state.phase === 'shop' && shop && !shop.open) {
        shop.showModal()
        shop.querySelector<HTMLElement>('#shop-title')?.focus()
      } else if (state.phase !== 'shop' && shop?.open) {
        shop.close()
      }
      this.previousPhase = state.phase
    }

    const dayNumber = state.day.replace(/\D/g, '') || state.day
    const rush = state.rush
    this.root.dataset.mode = rush ? 'rush' : 'campaign'
    this.set('hud-mode', rush ? 'RUSH/BEST' : 'DAY')
    this.set('hud-time-label', rush ? 'TIME/ARR' : 'TIME')
    this.set('hud-earned-label', rush ? 'EARN/GOAL' : 'EARNED')
    this.set('hud-served-label', rush ? 'SERVED/PAT' : 'SERVED')
    this.set('hud-day', dayNumber)
    this.setOptional('hud-best', rush ? ` · $${rush.best}` : '')
    this.setOptional('hud-arrival', rush ? ` · ${metric(rush.arrivalSeconds)}s` : '')
    this.setOptional('hud-patience', rush ? ` · ${metric(rush.patienceSeconds)}s` : '')
    this.root.querySelector('.shift-hud')?.setAttribute('aria-label', rush
      ? `Rush ${rush.level} status. Goal $${state.goal}. Best $${rush.best}. Arrivals every ${metric(rush.arrivalSeconds)} seconds. Patience ${metric(rush.patienceSeconds)} seconds.`
      : `Shift status. ${state.day}. ${clock(state.secondsRemaining)} remaining. Earned $${state.revenue} of $${state.goal}. Served ${state.served}. Missed ${state.missed}. Combo ${state.streak}.`)
    this.set('ready-day', state.day)
    this.set('results-day', `${state.day} RESULTS`)
    this.set('shop-day', `GEAR FOR ${state.day}`)
    this.set('ready-challenge', state.challenge ?? 'SERVE FAST. COLLECT EVERY COIN.')
    this.set('start', rush ? 'START RUSH' : 'START SHIFT')
    for (const card of ['ready', 'result', 'shop']) {
      this.fields[`${card}-rush-rules`].hidden = !rush
      if (!rush) continue
      this.set(`${card}-rush-goal`, `$${state.goal}`)
      this.set(`${card}-rush-best`, `$${rush.best}`)
      this.set(`${card}-rush-arrival`, `${metric(rush.arrivalSeconds)}s`)
      this.set(`${card}-rush-patience`, `${metric(rush.patienceSeconds)}s`)
    }
    this.setOptional('ready-unlock', state.readyBanner)
    this.setOptional('result-unlock', state.resultBanner)
    this.set('time', clock(state.secondsRemaining))
    this.set('revenue', `$${state.revenue}`)
    this.set('goal', ` / $${state.goal}`)
    this.set('served', state.served)
    this.set('missed', state.missed)
    this.set('streak', state.streak)
    const hasCombo = state.comboBonus != null
    const nextTier = state.comboNextAt
    this.setOptional('combo-tier', hasCombo
      ? `${nextTier == null ? '' : `/${nextTier} `}+$${state.comboBonus}` : '')
    const remaining = nextTier == null ? 0 : Math.max(0, nextTier - state.streak)
    const comboEventStatus = state.comboEvent?.kind === 'break'
      ? `Combo lost after ${state.comboEvent.streak} serves. `
      : state.comboEvent?.kind === 'gain' ? `Combo tier reached. ` : ''
    this.set('combo-status', hasCombo
      ? `${comboEventStatus}Combo ${state.streak}. Current bonus $${state.comboBonus} per serve.${nextTier == null
        ? ' Maximum tier.'
        : ` ${remaining} more ${remaining === 1 ? 'serve' : 'serves'} for the next tier.`}`
      : `Combo ${state.streak}.`)
    this.flashCombo(state.comboEvent)
    this.set('ready-goal', `$${state.goal}`)
    this.set('result-title', rush
      ? state.success ? 'RUSH CLEARED' : 'RUSH ENDED'
      : state.success ? 'SHIFT COMPLETE' : 'GOAL MISSED')
    this.set('result-revenue', `$${state.revenue}`)
    this.set('result-goal', ` / $${state.goal} GOAL`)
    this.set('result-served', state.served)
    this.set('result-missed', state.missed)
    this.set('result-streak', state.bestStreak)
    this.setOptional('stars', rush ? '' : `STARS ${state.stars} / 3`)
    const improved = Boolean(rush && rush.best > rush.previousBest)
    this.setOptional('result-best', rush
      ? improved
        ? `PRIOR $${rush.previousBest} → NEW BEST $${rush.best}`
        : `PRIOR BEST $${rush.previousBest} · STILL $${rush.best}`
      : '')
    this.fields['result-best'].classList.toggle('is-new', improved)
    this.set('cash', `$${state.cash ?? 0}`)
    this.set('result-retry', rush
      ? `${state.success ? 'REPLAY' : 'RETRY'} RUSH ${rush.level}`
      : state.success ? 'REPLAY' : 'RETRY')
    this.set('shop-retry', rush ? `RETRY RUSH ${rush.level}` : `RETRY DAY ${dayNumber}`)
    this.renderUpgrades(state.upgrades ?? [])
    this.set('helper-status', state.helper
      ? !state.helper.enabled
        ? `${state.helper.name} is off. Hire the Prep Pal in the upgrade shop.`
        : state.helper.remaining > 0
          ? `${state.helper.name} will be ready in ${Math.ceil(state.helper.remaining)} seconds.`
          : `${state.helper.name} is ready for the next front order.`
      : '')

    const canAdvance = state.canAdvance ?? state.success
    this.root.querySelectorAll<HTMLButtonElement>('[data-action="next"]').forEach(button => { button.disabled = !canAdvance })
    this.set('shop-next', advanceLabel(state))
    this.fields['shop-next'].hidden = !canAdvance
    this.fields['shop-retry'].hidden = canAdvance

    const ticket = this.fields.ticket
    const showTicket = state.phase === 'playing' && Boolean(state.order)
    this.fields['order-panel'].hidden = !showTicket
    const warning = state.warning ?? (state.wrongItem ? 'WRONG ITEM' : '')
    ticket.classList.toggle('is-wrong', Boolean(warning))
    ticket.classList.toggle('is-urgent', Boolean(state.order?.urgent))
    this.set('ticket-guidance', warning || state.recipe?.instruction || 'GET THE INGREDIENTS')
    this.renderRecipe(state.recipe?.steps ?? [], state.order?.label ?? '')
    const progress = state.recipe?.progress
    const progressBar = this.fields['prep-progress']
    progressBar.hidden = progress == null
    if (progress != null) {
      const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100)
      progressBar.style.width = `${percent}%`
      progressBar.setAttribute('aria-valuenow', String(percent))
      progressBar.setAttribute('aria-valuetext', `${percent}% prepared`)
    }
    const trayItems = state.trayItems ?? []
    const counterItems = state.counterItems ?? []
    this.renderInventory('tray', trayItems)
    this.renderInventory('counter', counterItems)
    const inventory = this.root.querySelector<HTMLElement>('.inventory-readout')
    const inventoryEmpty = trayItems.length === 0 && counterItems.length === 0
    inventory?.classList.toggle('is-empty', inventoryEmpty)
    if (inventoryEmpty) inventory?.setAttribute('aria-label', 'Tray and counter empty')
    else inventory?.removeAttribute('aria-label')
    this.renderUpcoming(state.upcomingOrders ?? [])
    if (!state.order?.urgent) this.set('urgent-status', '')
    if (!state.order) return
    this.set('order-label', state.order.label)
    this.set('order-quantity', `×${state.order.quantity}`)
    this.set('order-price', `$${state.order.price}`)
    this.set('order-payout', `MAX $${state.order.potentialPayout}`)
    this.set('patience-seconds', `${state.order.patienceSeconds}s`)
    this.set('tip-value', `TIP +$${state.order.tip}`)
    this.set('projected-combo', `COMBO +$${state.order.potentialCombo}`)
    const icon = this.fields['order-icon'] as HTMLImageElement
    if (state.order.icon && icon.getAttribute('src') !== state.order.icon) icon.src = state.order.icon
    this.fields.patience.style.width = `${Math.round(Math.max(0, Math.min(1, state.order.patience)) * 100)}%`
    const patience = this.fields['patience-track']
    patience.setAttribute('aria-valuemax', String(state.order.patienceMax))
    patience.setAttribute('aria-valuenow', String(state.order.patienceSeconds))
    patience.setAttribute('aria-valuetext', `${state.order.patienceSeconds} seconds remaining. Maximum payout $${state.order.potentialPayout} at current patience: $${state.order.price} order, up to $${state.order.tip} tip, up to $${state.order.potentialCombo} combo.`)
    if (state.urgentEvent && state.urgentEvent.serial !== this.previousUrgentEvent) {
      this.previousUrgentEvent = state.urgentEvent.serial
      const unit = state.order.patienceSeconds === 1 ? 'second' : 'seconds'
      this.set('urgent-status', `Hurry: ${state.order.patienceSeconds} ${unit} left for ${state.order.label}. Maximum payout is now $${state.order.potentialPayout}.`)
    }
  }

  private set(field: string, value: string | number): void {
    const text = String(value)
    const target = this.fields[field]
    if (target && target.textContent !== text) target.textContent = text
  }

  private setOptional(field: string, value = ''): void {
    const target = this.fields[field]
    if (!target) return
    this.set(field, value)
    target.hidden = !value
  }

  private renderUpgrades(upgrades: UpgradeUiItem[]): void {
    const target = this.fields.upgrades
    const signature = upgrades.map(upgrade => [
      upgrade.id, upgrade.level, upgrade.price, upgrade.before, upgrade.after, upgrade.affordable,
      upgrade.helper?.name, upgrade.helper?.image,
    ].join(':')).join('|')
    if (target.dataset.signature === signature) return
    target.dataset.signature = signature
    target.replaceChildren(...upgrades.map(upgrade => {
      if (upgrade.helper) return this.renderHelperUpgrade(upgrade)
      const card = document.createElement('article')
      card.className = 'upgrade-card'
      card.dataset.upgradeCard = upgrade.id
      card.dataset.level = String(upgrade.level)
      card.dataset.price = upgrade.price === null ? '' : String(upgrade.price)
      card.dataset.affordable = String(upgrade.affordable)
      card.setAttribute('aria-label', `${upgrade.name}, level ${upgrade.level} of ${upgrade.maxLevel}`)

      const name = document.createElement('h2')
      name.textContent = upgrade.name
      const level = document.createElement('p')
      level.className = 'upgrade-level'
      level.textContent = `LEVEL ${upgrade.level} / ${upgrade.maxLevel}`
      const change = document.createElement('div')
      change.className = 'upgrade-change'
      const before = document.createElement('strong')
      before.textContent = upgrade.before
      const arrow = document.createElement('span')
      arrow.textContent = '→'
      const after = document.createElement('strong')
      after.textContent = upgrade.after
      const stat = document.createElement('small')
      stat.textContent = upgrade.stat
      change.append(before, arrow, after, stat)
      const buy = document.createElement('button')
      buy.type = 'button'
      buy.dataset.upgrade = upgrade.id
      buy.setAttribute('aria-label', upgrade.capped
        ? `${upgrade.name} is at maximum level`
        : `${upgrade.affordable ? 'Buy' : 'Need cash for'} ${upgrade.name} level ${upgrade.level + 1} for $${upgrade.price}`)
      buy.textContent = upgrade.capped ? 'MAX LEVEL' : `${upgrade.affordable ? 'BUY' : 'NEED'}  $${upgrade.price}`
      buy.disabled = upgrade.capped || !upgrade.affordable
      card.append(name, level, change, buy)
      return card
    }))
  }

  private renderHelperUpgrade(upgrade: UpgradeUiItem): HTMLElement {
    const helper = upgrade.helper!
    const card = document.createElement('article')
    card.className = 'upgrade-card helper-upgrade'
    card.dataset.upgradeCard = upgrade.id
    card.dataset.level = String(upgrade.level)
    card.dataset.price = upgrade.price === null ? '' : String(upgrade.price)
    card.dataset.affordable = String(upgrade.affordable)

    const currentSeconds = upgrade.level ? Math.round(60 / Number(upgrade.before)) : null
    const nextSeconds = Math.round(60 / Number(upgrade.after))
    card.setAttribute('aria-label', upgrade.level
      ? `${helper.name}, Prep Pal, level ${upgrade.level} of ${upgrade.maxLevel}. Stages ingredients for the front order every ${currentSeconds} seconds.`
      : `${helper.name}, Prep Pal, not hired. Stages ingredients for the front order every ${nextSeconds} seconds.`)
    card.dataset.purchaseMessage = upgrade.level
      ? `${helper.name} upgraded. Stages ingredients every ${nextSeconds} seconds.`
      : `${helper.name} hired. Stages ingredients every ${nextSeconds} seconds.`

    const avatar = document.createElement('img')
    avatar.className = 'helper-avatar'
    avatar.src = helper.image
    avatar.alt = ''

    const copy = document.createElement('div')
    copy.className = 'helper-copy'
    const name = document.createElement('h2')
    name.textContent = helper.name
    const role = document.createElement('p')
    role.className = 'helper-role'
    role.textContent = `PREP PAL · LV ${upgrade.level}/${upgrade.maxLevel}`
    const description = document.createElement('p')
    description.className = 'helper-description'
    description.textContent = `${helper.name} STAGES INGREDIENTS. YOU FINISH + SERVE.`
    copy.append(name, role, description)

    const offer = document.createElement('div')
    offer.className = 'helper-offer'
    const change = document.createElement('div')
    change.className = 'helper-change'
    const before = document.createElement('strong')
    before.textContent = upgrade.level ? `${upgrade.before}/MIN` : 'OFF'
    const arrow = document.createElement('span')
    arrow.textContent = upgrade.capped ? '' : '→'
    const after = document.createElement('strong')
    after.textContent = upgrade.capped ? '' : `${upgrade.after}/MIN`
    const stat = document.createElement('small')
    stat.textContent = 'STAGES/MIN'
    change.append(before, arrow, after, stat)

    const buy = document.createElement('button')
    buy.type = 'button'
    buy.dataset.upgrade = upgrade.id
    buy.setAttribute('aria-label', upgrade.capped
      ? `${helper.name} is at maximum level`
      : `${upgrade.affordable ? 'Buy' : 'Need cash for'} ${helper.name} level ${upgrade.level + 1} for $${upgrade.price}; stages ingredients every ${nextSeconds} seconds`)
    buy.textContent = upgrade.capped ? 'MAX LEVEL' : `${upgrade.affordable ? 'BUY' : 'NEED'} $${upgrade.price}`
    buy.disabled = upgrade.capped || !upgrade.affordable
    offer.append(change, buy)
    card.append(avatar, copy, offer)
    return card
  }

  private renderInventory(name: string, items: InventoryUiItem[]): void {
    const target = this.root.querySelector<HTMLElement>(`[data-inventory="${name}"]`)
    if (!target) return
    const signature = items.map(item => `${item.icon}:${item.count}`).join('|') || 'empty'
    if (target.dataset.signature === signature) return
    target.dataset.signature = signature
    if (items.length === 0) {
      const empty = document.createElement('em')
      empty.textContent = 'EMPTY'
      target.replaceChildren(empty)
      return
    }
    target.replaceChildren(...items.flatMap(item => {
      const icon = document.createElement('img')
      icon.src = item.icon
      icon.alt = item.label
      const count = document.createElement('b')
      count.textContent = `×${item.count}`
      return [icon, count]
    }))
  }

  private renderRecipe(steps: NonNullable<ShiftUiState['recipe']>['steps'], label: string): void {
    const target = this.fields['recipe-list']
    const signature = steps.map(step => `${step.label}:${step.have}:${step.need}`).join('|')
    if (target.dataset.signature === signature) return
    target.dataset.signature = signature
    target.setAttribute('aria-label', label ? `Recipe for ${label}, per item` : 'Recipe')
    let current = false
    target.replaceChildren(...steps.map(step => {
      const item = document.createElement('li')
      const done = step.have >= step.need
      if (done) item.className = 'is-done'
      else if (!current) {
        current = true
        item.className = 'is-current'
        item.ariaCurrent = 'step'
      }
      const icon = document.createElement('img')
      icon.src = step.icon
      icon.alt = ''
      const name = document.createElement('span')
      name.textContent = step.label
      const count = document.createElement('b')
      count.textContent = `${Math.min(step.have, step.need)}/${step.need}`
      item.append(icon, name, count)
      return item
    }))
  }

  private renderUpcoming(orders: UpcomingOrderUiItem[]): void {
    const target = this.fields['upcoming-orders']
    const rail = target.closest<HTMLElement>('.next-orders')
    const upcoming = orders.slice(0, 2)
    const signature = upcoming.map(order => [
      order.icon, order.label, order.quantity, order.actionable, order.patience != null,
    ].join(':')).join('|')
    if (target.dataset.signature !== signature) {
      target.dataset.signature = signature
      target.replaceChildren(...upcoming.map((order, index) => {
        const item = document.createElement('li')
        item.dataset.label = order.label
        item.dataset.quantity = String(order.quantity)
        const position = document.createElement('span')
        position.className = 'next-position'
        position.ariaHidden = 'true'
        position.textContent = String(index + 2)
        const icon = document.createElement('img')
        icon.src = order.icon
        icon.alt = ''
        const quantity = document.createElement('b')
        quantity.ariaHidden = 'true'
        quantity.textContent = `×${order.quantity}`
        const seconds = document.createElement('span')
        seconds.className = 'next-seconds'
        seconds.ariaHidden = 'true'
        const patience = document.createElement('i')
        patience.className = 'next-patience'
        patience.ariaHidden = 'true'
        const state = document.createElement('span')
        state.className = 'next-state'
        state.ariaHidden = 'true'
        item.append(position, icon, quantity, seconds, patience, state)
        return item
      }))
    }
    upcoming.forEach((order, index) => {
      const item = target.children[index] as HTMLElement | undefined
      const patience = item?.querySelector<HTMLElement>('.next-patience')
      const seconds = item?.querySelector<HTMLElement>('.next-seconds')
      const state = item?.querySelector<HTMLElement>('.next-state')
      if (!item || !patience || !seconds || !state) return
      const waiting = order.patience != null && order.seconds != null
      const actionable = waiting && order.actionable
      const availability = actionable ? 'actionable' : waiting ? 'waiting' : 'preview'
      const wholeSeconds = Math.max(0, Math.ceil(order.seconds ?? 0))
      const percent = Math.round(Math.max(0, Math.min(1, order.patience ?? 0)) * 100)
      item.className = `is-${availability}`
      item.dataset.state = availability
      state.textContent = actionable ? 'NOW' : waiting ? 'WAIT' : 'SOON'
      item.setAttribute('aria-label', `Order ${index + 2}: ${order.label}, quantity ${order.quantity}; ${actionable
        ? `actionable now, ${wholeSeconds} seconds remaining`
        : waiting ? `waiting outside the active service window, ${wholeSeconds} seconds remaining`
          : 'preview only, not waiting yet, not spawned and cannot be served yet'}`)
      seconds.hidden = !waiting
      seconds.textContent = `${wholeSeconds}s`
      patience.hidden = !waiting
      patience.style.width = `${percent}%`
    })
    rail?.classList.toggle('is-empty', upcoming.length === 0)
    if (upcoming.length === 0) rail?.setAttribute('aria-hidden', 'true')
    else rail?.removeAttribute('aria-hidden')
  }

  private flashCombo(event?: ShiftUiState['comboEvent']): void {
    if (!event || event.serial === this.previousComboEvent) return
    this.previousComboEvent = event.serial
    const target = this.fields['combo-card']
    target.classList.remove('is-gain', 'is-break')
    void target.offsetWidth
    target.classList.add(event.kind === 'gain' ? 'is-gain' : 'is-break')
    if (this.comboTimer != null) window.clearTimeout(this.comboTimer)
    this.comboTimer = window.setTimeout(() => target.classList.remove('is-gain', 'is-break'), 450)
  }
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function metric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function advanceLabel(state: Pick<ShiftUiState, 'rush' | 'finalDay' | 'canStartScoreChase' | 'day'>): string {
  if (state.rush) return 'NEXT RUSH'
  if (!state.finalDay) return 'NEXT DAY'
  return state.canStartScoreChase ? 'START SCORE CHASE' : `REPLAY ${state.day}`
}
