import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })

test('unlocks sound on tap, persists mute, and keeps its control outside the portrait play lane', async ({ page }) => {
  await page.addInitScript(() => {
    const starts: number[] = []
    Object.defineProperty(window, '__soundStarts', { value: starts })
    const contexts: TestAudioContext[] = []
    Object.defineProperty(window, '__soundContexts', { value: contexts })
    class Param {
      setValueAtTime() { return this }
      exponentialRampToValueAtTime() { return this }
    }
    class TestAudioContext {
      currentTime = 0
      state = 'suspended'
      destination = {}
      resumeCalls = 0
      constructor() { contexts.push(this) }
      resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve() }
      createOscillator() {
        return {
          type: 'sine',
          frequency: new Param(),
          connect: () => {},
          start: (time = 0) => { starts.push(time) },
          stop: () => {},
        }
      }
      createGain() { return { gain: new Param(), connect: () => {} } }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: TestAudioContext })
  })

  await page.goto('/')
  await page.evaluate(() => window.__scoopaloo.pause(true))
  const sound = page.getByRole('button', { name: 'Sound' })
  await expect(sound).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __soundStarts: number[] }).__soundStarts.length)).toBeGreaterThan(0)
  expect(await page.evaluate(() => {
    const [context] = (window as unknown as { __soundContexts: { resumeCalls: number }[] }).__soundContexts
    return context.resumeCalls
  })).toBe(1)
  await page.evaluate(() => {
    const [context] = (window as unknown as { __soundContexts: { state: string }[] }).__soundContexts
    context.state = 'suspended'
  })
  await page.locator('#game').click({ position: { x: 180, y: 700 } })
  await expect.poll(() => page.evaluate(() => {
    const [context] = (window as unknown as { __soundContexts: { resumeCalls: number }[] }).__soundContexts
    return context.resumeCalls
  })).toBe(2)

  const layout = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
    const sound = box('#sound-button')
    const save = box('#save-button')
    const hud = box('.shift-hud')
    const ticket = box('.order-ticket')
    const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    return {
      inside: sound.left >= 0 && sound.top >= 0 && sound.right <= innerWidth && sound.bottom <= innerHeight,
      clear: !overlaps(sound, save) && !overlaps(sound, hud) && !overlaps(sound, ticket),
      canvas: box('#game').toJSON(),
    }
  })
  expect(layout.inside).toBe(true)
  expect(layout.clear).toBe(true)
  expect(layout.canvas.height).toBeGreaterThan(layout.canvas.width)

  await sound.click()
  await expect(sound).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => localStorage.getItem('scoopaloo.sound.muted.v1'))).toBe('1')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Sound' }).click()
  await expect(page.getByRole('button', { name: 'Sound' })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => localStorage.getItem('scoopaloo.sound.muted.v1'))).toBe('0')
})
