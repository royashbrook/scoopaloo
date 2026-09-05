import { readFileSync, statSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// #70: hold the sheets in flight and press play. the shift must WAIT, then start
// populated, instead of dropping the kid into an empty room.
test('play waits for the world instead of starting in an empty room', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/assets/{scoopaloo-atlas,player-walk}.webp*', async route => {
    await gate
    await route.continue()
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'START SHIFT' }).click()

  // while the art is in flight: still on the ready screen, button says so
  await expect(page.locator('[data-field="start"]')).toHaveText('OPENING THE SHOP…')
  await page.waitForTimeout(600)
  const during = await page.evaluate(() => window.__scoopaloo.snapshot().phase)
  expect(during, 'the shift must not start while the world is missing').toBe('ready')

  release()
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().phase), { timeout: 10_000 })
    .toBe('playing')
  const decoded = await page.evaluate(() => {
    const images = [...document.images].map(image => image.complete)
    return images.every(Boolean)
  })
  expect(decoded).toBe(true)
})

// #65: the two sheets stay under budget so a first load is phone-friendly, and
// no dead png sheet or superseded icon sneaks back into the build.
test('the asset diet holds', async () => {
  const sheet = (name: string) => statSync(`public/assets/${name}`).size / 1024
  const atlas = sheet('scoopaloo-atlas.webp')
  const walk = sheet('player-walk.webp')
  console.log(`atlas ${atlas.toFixed(0)}KB, walk ${walk.toFixed(0)}KB`)
  expect(atlas, 'atlas budget').toBeLessThan(400)
  expect(walk, 'walk sheet budget').toBeLessThan(400)
  for (const gone of ['assets/scoopaloo-atlas.png', 'assets/player-walk.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
    expect(() => statSync(`public/${gone}`), `${gone} must stay deleted`).toThrow()
  }
  const worker = readFileSync('public/sw.js', 'utf8')
  expect(worker).toContain('scoopaloo-atlas.webp')
  expect(worker).toContain('player-walk.webp')
  expect(worker, 'no png sheet in the shell').not.toContain('atlas.png')
})
