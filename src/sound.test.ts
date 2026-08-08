import { describe, expect, it } from 'vitest'
import {
  GameSound,
  SOUND_MUTED_KEY,
  type SoundContext,
  type SoundCue,
} from './sound'

class FakeParam {
  events: { value: number, time: number }[] = []

  setValueAtTime(value: number, time: number) {
    this.events.push({ value, time })
    return this
  }

  exponentialRampToValueAtTime(value: number, time: number) {
    this.events.push({ value, time })
    return this
  }
}

class FakeContext {
  currentTime = 10
  state = 'suspended'
  destination = {}
  resumeCalls = 0
  oscillators: {
    type: OscillatorType
    frequency: FakeParam
    starts: number[]
    stops: number[]
  }[] = []
  gains: FakeParam[] = []
  delayResume = false
  finishResume?: () => void

  async resume() {
    this.resumeCalls++
    if (this.delayResume) await new Promise<void>(resolve => { this.finishResume = resolve })
    this.state = 'running'
  }

  createOscillator() {
    const node = {
      type: 'sine' as OscillatorType,
      frequency: new FakeParam(),
      starts: [] as number[],
      stops: [] as number[],
      connect: (destination: unknown) => destination,
      start(time = 0) { node.starts.push(time) },
      stop(time = 0) { node.stops.push(time) },
    }
    this.oscillators.push(node)
    return node
  }

  createGain() {
    const gain = new FakeParam()
    this.gains.push(gain)
    return {
      gain,
      connect: (destination: unknown) => destination,
    }
  }
}

const storage = (initial?: string) => {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(SOUND_MUTED_KEY, initial)
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('mobile sound', () => {
  it('does not create audio until a user-gesture method unlocks it', async () => {
    const context = new FakeContext()
    let factoryCalls = 0
    const sound = new GameSound(storage(), () => {
      factoryCalls++
      return context as SoundContext
    })

    sound.play('pickup')
    expect(factoryCalls).toBe(0)
    sound.unlock()
    await Promise.resolve()
    sound.unlock()
    expect(factoryCalls).toBe(1)
    expect(context.resumeCalls).toBe(1)
  })

  it('plays every cue as a short, quiet, stopped envelope', async () => {
    const context = new FakeContext()
    const sound = new GameSound(storage(), () => context as SoundContext)
    sound.unlock()
    await Promise.resolve()
    const cues: SoundCue[] = [
      'pickup', 'drop', 'pour', 'pay', 'reject',
      'prep-start', 'prep-ready', 'blocked', 'combo', 'combo-break',
      'start', 'success', 'fail', 'buy', 'next',
    ]

    for (const cue of cues) {
      const before = context.oscillators.length
      sound.play(cue)
      expect(context.oscillators.length).toBeGreaterThan(before)
    }

    expect(context.oscillators.every(node =>
      node.starts.length === 1
      && node.stops.length === 1
      && node.stops[0] > node.starts[0]
      && node.stops[0] <= context.currentTime + .4,
    )).toBe(true)
    expect(context.gains.every(gain =>
      gain.events.some(event => event.value === .025)
      && gain.events.at(-1)?.value === .0001,
    )).toBe(true)
  })

  it('plays a cue requested while the first gesture is still resuming audio', async () => {
    const context = new FakeContext()
    context.delayResume = true
    const sound = new GameSound(storage(), () => context as SoundContext)

    sound.unlock()
    sound.play('start')
    expect(context.oscillators).toHaveLength(0)
    context.finishResume?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(context.oscillators.length).toBeGreaterThan(0)
  })

  it('resumes an interrupted mobile context and keeps only the latest waiting cue', async () => {
    const context = new FakeContext()
    context.state = 'interrupted'
    context.delayResume = true
    const sound = new GameSound(storage(), () => context as SoundContext)

    sound.unlock()
    sound.play('pour')
    sound.play('pay')
    context.finishResume?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(context.resumeCalls).toBe(1)
    expect(context.oscillators).toHaveLength(2)
  })

  it('persists mute and only creates audio when toggled back on', async () => {
    const saved = storage('1')
    const context = new FakeContext()
    let factoryCalls = 0
    const sound = new GameSound(saved, () => {
      factoryCalls++
      return context as SoundContext
    })

    expect(sound.enabled()).toBe(false)
    sound.unlock()
    sound.play('start')
    expect(factoryCalls).toBe(0)

    expect(sound.toggle()).toBe(true)
    await Promise.resolve()
    expect(factoryCalls).toBe(1)
    expect(saved.values.get(SOUND_MUTED_KEY)).toBe('0')
    expect(sound.toggle()).toBe(false)
    expect(saved.values.get(SOUND_MUTED_KEY)).toBe('1')
    expect(new GameSound(saved).enabled()).toBe(false)
  })

  it('gracefully ignores missing or broken Web Audio', () => {
    const missing = new GameSound(storage(), () => undefined)
    expect(() => missing.unlock()).not.toThrow()
    expect(() => missing.play('pay')).not.toThrow()

    const broken = new GameSound(storage(), () => { throw new Error('blocked') })
    expect(() => broken.unlock()).not.toThrow()
    expect(() => broken.play('fail')).not.toThrow()
  })
})
