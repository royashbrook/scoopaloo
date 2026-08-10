import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' })

test('unlocks sound on tap, persists mute, and removes the menu from the portrait play lane', async ({ page }) => {
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
  const sound = page.locator('#sound-button')
  await expect(sound).toHaveAttribute('aria-pressed', 'true')
  await sound.click()
  await expect(sound).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => localStorage.getItem('scoopaloo.sound.muted.v1'))).toBe('1')
  await page.reload()
  const restoredSound = page.locator('#sound-button')
  await expect(restoredSound).toHaveAttribute('aria-pressed', 'false')
  await restoredSound.click()
  await expect(restoredSound).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => localStorage.getItem('scoopaloo.sound.muted.v1'))).toBe('0')

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
    const nav = box('#bottom-nav')
    const hud = box('.shift-hud')
    const ticket = box('.order-ticket')
    const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    return {
      menuHidden: nav.width === 0 && nav.height === 0,
      hudClear: !overlaps(hud, ticket),
      canvas: box('#game').toJSON(),
    }
  })
  expect(layout.menuHidden).toBe(true)
  expect(layout.hudClear).toBe(true)
  expect(layout.canvas.height).toBeGreaterThan(layout.canvas.width)
})
