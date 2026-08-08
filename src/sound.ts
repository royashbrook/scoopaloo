export type SoundCue =
  | 'pickup'
  | 'drop'
  | 'pour'
  | 'pay'
  | 'reject'
  | 'prep-start'
  | 'prep-ready'
  | 'blocked'
  | 'combo'
  | 'combo-break'
  | 'hurry'
  | 'start'
  | 'success'
  | 'fail'
  | 'buy'
  | 'next'

export const SOUND_MUTED_KEY = 'scoopaloo.sound.muted.v1'

type Note = readonly [
  frequency: number,
  delay: number,
  duration: number,
  wave?: OscillatorType,
]

const cues: Record<SoundCue, readonly Note[]> = {
  pickup: [[760, 0, .08]],
  drop: [[360, 0, .1, 'triangle']],
  pour: [[420, 0, .1], [360, .07, .12]],
  pay: [[740, 0, .08, 'triangle'], [990, .07, .12, 'triangle']],
  reject: [[150, 0, .16, 'sawtooth'], [120, .12, .16, 'sawtooth']],
  'prep-start': [[440, 0, .08, 'triangle'], [560, .07, .1, 'triangle']],
  'prep-ready': [[523, 0, .08], [659, .06, .08], [784, .12, .14]],
  blocked: [[190, 0, .12, 'triangle']],
  combo: [[587, 0, .07], [740, .055, .08], [988, .11, .13]],
  'combo-break': [[330, 0, .08, 'triangle'], [247, .07, .1, 'triangle'], [185, .15, .13, 'triangle']],
  hurry: [[784, 0, .06, 'triangle'], [784, .12, .06, 'triangle']],
  start: [[330, 0, .08], [440, .07, .08], [660, .14, .13]],
  success: [[523, 0, .1], [659, .08, .1], [784, .16, .18]],
  fail: [[330, 0, .12], [247, .1, .12], [196, .2, .18]],
  buy: [[660, 0, .08], [880, .06, .14]],
  next: [[392, 0, .1], [523, .08, .1], [659, .16, .18]],
}

type SoundParam = {
  setValueAtTime(value: number, time: number): unknown
  exponentialRampToValueAtTime(value: number, time: number): unknown
}

type SoundNode = {
  connect(destination: any): unknown
}

export type SoundContext = {
  readonly currentTime: number
  readonly state: string
  readonly destination: unknown
  resume(): Promise<void>
  createOscillator(): SoundNode & {
    type: OscillatorType
    readonly frequency: SoundParam
    start(time?: number): void
    stop(time?: number): void
  }
  createGain(): SoundNode & { readonly gain: SoundParam }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
type ContextFactory = () => SoundContext | undefined

const browserStorage = (): StorageLike | undefined => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const browserContext: ContextFactory = () => {
  const globals = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }
  const Context = globals.AudioContext ?? globals.webkitAudioContext
  return Context ? new Context() : undefined
}

export class GameSound {
  private isEnabled = true
  private context?: SoundContext
  private resuming = false
  private waiting?: SoundCue

  constructor(
    private readonly storage = browserStorage(),
    private readonly contextFactory: ContextFactory = browserContext,
  ) {
    try {
      this.isEnabled = storage?.getItem(SOUND_MUTED_KEY) !== '1'
    } catch {
      this.isEnabled = true
    }
  }

  enabled(): boolean {
    return this.isEnabled
  }

  unlock(): void {
    if (!this.isEnabled) return
    try {
      this.context ??= this.contextFactory()
      if (this.context && this.context.state !== 'running' && this.context.state !== 'closed' && !this.resuming) {
        this.resuming = true
        void this.context.resume()
          .then(() => {
            const waiting = this.waiting
            this.waiting = undefined
            if (waiting) this.play(waiting)
          })
          .catch(() => { this.waiting = undefined })
          .finally(() => { this.resuming = false })
      }
    } catch {
      this.context = undefined
    }
  }

  toggle(): boolean {
    this.isEnabled = !this.isEnabled
    try {
      this.storage?.setItem(SOUND_MUTED_KEY, this.isEnabled ? '0' : '1')
    } catch {
      // Storage can be unavailable in private browsing.
    }
    if (this.isEnabled) this.unlock()
    else this.waiting = undefined
    return this.isEnabled
  }

  play(cue: SoundCue): void {
    const context = this.context
    if (!this.isEnabled || !context) return
    if (context.state !== 'running' && context.state !== 'closed') {
      this.waiting = cue
      return
    }
    if (context.state !== 'running') return

    for (const [frequency, delay, duration, wave = 'sine'] of cues[cue]) {
      const start = context.currentTime + delay
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = wave
      oscillator.frequency.setValueAtTime(frequency, start)
      gain.gain.setValueAtTime(.0001, start)
      gain.gain.exponentialRampToValueAtTime(.025, start + Math.min(.015, duration / 3))
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + duration + .01)
    }
  }
}
