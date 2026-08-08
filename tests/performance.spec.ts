import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true })

test('keeps a 60 fps frame budget at tablet size', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.__scoopaloo.startShift())
  const frameTimes = await page.evaluate(() => new Promise<number[]>(resolve => {
    const samples: number[] = []
    let previous = performance.now()
    const sample = (now: number) => {
      samples.push(now - previous)
      previous = now
      if (samples.length === 90) resolve(samples.slice(5))
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  frameTimes.sort((a, b) => a - b)
  const p95 = frameTimes[Math.floor(frameTimes.length * .95)]
  expect(p95).toBeLessThan(25)
})
