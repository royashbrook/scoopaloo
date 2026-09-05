import { expect, test, type Page } from '@playwright/test'
import type { FloorState } from '../src/shop-floor'
import { defaultSave } from '../src/engine'
import type { GameSkin } from '../src/skin'
import skinData from '../src/skins/ice-cream.json' with { type: 'json' }

test.use({ viewport: { width: 430, height: 932 }, hasTouch: true })
const snapshot = (page: Page) => page.evaluate(() => (window as any).__shopFloor.snapshot() as FloorState)
async function walk(page: Page, target: { x: number; y: number }) {
  for (const axis of ['y', 'x'] as const) {
    const from = (await snapshot(page)).player[axis]
    const delta = target[axis] - from
    if (Math.abs(delta) < 10) continue
    const key = axis === 'x' ? delta < 0 ? 'ArrowLeft' : 'ArrowRight' : delta < 0 ? 'ArrowUp' : 'ArrowDown'
    await page.keyboard.down(key)
    await expect.poll(async () => Math.abs((await snapshot(page)).player[axis] - target[axis]), { timeout: 5000, intervals: [20] }).toBeLessThan(14)
    await page.keyboard.up(key)
  }
}

test('real controls: earn the patio, hire Pip, buy a party table and serve all six friends', async ({ page }) => {
  test.setTimeout(120000)
  await page.addInitScript(() => localStorage.setItem('scoopaloo_save_v1', 'campaign must stay untouched'))
  await page.goto('/shop-floor.html')
  await expect(page.locator('#hint')).toContainText('Drag to the cones')
  const began = Date.now()
  await walk(page, { x: 150, y: 450 })
  await expect.poll(async () => (await snapshot(page)).player.cones).toBe(3)
  await walk(page, { x: 475, y: 415 })
  await expect.poll(async () => (await snapshot(page)).save.served).toBeGreaterThanOrEqual(2)
  expect(Date.now() - began).toBeLessThan(10000)
  await walk(page, { x: 320, y: 620 })
  await expect(page.locator('#milestone')).toHaveText('PATIO OPEN!')
  expect(Date.now() - began).toBeLessThan(60000)
  await page.screenshot({ path: 'test-results/shop-floor-patio-iphone.png' })
  await walk(page, { x: 150, y: 450 })
  await expect.poll(async () => (await snapshot(page)).player.cones).toBe(3)
  await walk(page, { x: 475, y: 415 })
  await expect.poll(async () => (await snapshot(page)).save.cash).toBeGreaterThanOrEqual(60)
  await walk(page, { x: 155, y: 800 })
  await expect(page.locator('#milestone')).toHaveText('A TEAM OF TWO')
  await expect.poll(async () => (await snapshot(page)).helperServed, { timeout: 12000 }).toBeGreaterThan(0)
  expect(await page.evaluate(() => localStorage.getItem('scoopaloo_save_v1'))).toBe('campaign must stay untouched')
  await page.screenshot({ path: 'test-results/shop-floor-helper-iphone.png' })
  const save = (await snapshot(page)).save
  const player = (await snapshot(page)).player
  await page.reload()
  await expect(page.locator('#milestone')).toHaveText('A TEAM OF TWO')
  expect((await snapshot(page)).save).toEqual(save)
  expect((await snapshot(page)).player.x).toBeCloseTo(player.x)
  expect((await snapshot(page)).player.y).toBeCloseTo(player.y)
  expect((await snapshot(page)).player.cones).toBe(player.cones)
  await expect.poll(async () => (await snapshot(page)).save.cash, { timeout: 45000 }).toBeGreaterThanOrEqual(160)
  await walk(page, { x: 320, y: 590 })
  await expect(page.locator('#milestone')).toHaveText('PARTY 0/6')
  await page.screenshot({ path: 'test-results/shop-floor-party-table-iphone.png' })
  for (const count of [3, 6]) {
    await walk(page, { x: 150, y: 450 })
    await expect.poll(async () => (await snapshot(page)).player.cones).toBe(3)
    await walk(page, { x: 285, y: 835 })
    await expect.poll(async () => (await snapshot(page)).save.partyServed, { timeout: 10000 }).toBe(count)
  }
  await expect(page.getByRole('dialog', { name: 'PARTY COMPLETE!' })).toBeVisible()
  await page.screenshot({ path: 'test-results/shop-floor-party-complete-iphone.png' })
  const complete = await snapshot(page)
  expect(complete.paused).toBe(true)
  await page.waitForTimeout(350)
  expect(await snapshot(page)).toEqual(complete)
  expect(await page.evaluate(() => localStorage.getItem('scoopaloo_save_v1'))).toBe('campaign must stay untouched')
})

test('pause/visibility freezes the shop and does not leave a held joystick running', async ({ page }) => {
  await page.goto('/shop-floor.html')
  await expect(page.locator('#hint')).toContainText('Drag to the cones')
  await page.mouse.move(220, 530); await page.mouse.down(); await page.mouse.move(280, 530)
  await page.evaluate(() => dispatchEvent(new Event('blur')))
  await expect(page.getByRole('dialog', { name: 'SHOP PAUSED' })).toBeVisible()
  const before = await snapshot(page)
  await page.waitForTimeout(350)
  expect(await snapshot(page)).toEqual(before)
  await page.mouse.up()
  await page.getByRole('button', { name: 'KEEP PLAYING' }).click()
  const position = (await snapshot(page)).player
  await page.waitForTimeout(200)
  expect((await snapshot(page)).player.x).toBe(position.x)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('dialog', { name: 'SHOP PAUSED' })).toBeVisible()
  const hidden = await snapshot(page)
  await page.waitForTimeout(200)
  expect(await snapshot(page)).toEqual(hidden)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('dialog', { name: 'SHOP PAUSED' })).toBeVisible()
})

test('campaign end preserves paid earnings and the empty ticket uses its entire row', async ({ page }) => {
  const saved = defaultSave(skinData as GameSkin)
  saved.currentDay = 1
  await page.addInitScript(save => localStorage.setItem('scoopaloo_save_v1', JSON.stringify(save)), saved)
  await page.goto('/')
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  const layout = await page.locator('.inventory-readout').evaluate(el => {
    const style = getComputedStyle(el)
    const pseudo = getComputedStyle(el, '::after')
    return { empty: el.classList.contains('is-empty'), rows: style.gridTemplateRows.split(' ').length,
      height: el.clientHeight, required: parseFloat(pseudo.lineHeight) * 2 + parseFloat(pseudo.paddingTop) + parseFloat(pseudo.paddingBottom) }
  })
  expect(layout.empty).toBe(true)
  expect(layout.rows).toBe(1)
  expect(layout.required).toBeLessThanOrEqual(layout.height)
  await page.getByRole('button', { name: 'Pause shift' }).click()
  await page.getByRole('button', { name: 'MOVE YOUR SAVE', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'MOVE YOUR SAVE' })).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'SHIFT PAUSED' })).toBeVisible()
  await page.getByRole('button', { name: 'END SHIFT', exact: true }).click()
  await expect(page.locator('[data-field="result-title"]')).toHaveText('SHIFT ENDED')
  await expect(page.locator('#bottom-nav')).toBeVisible()
  expect((await page.evaluate(() => window.__scoopaloo.snapshot())).phase).toBe('results')
})

test('idle life respects reduced motion and a new-shop reset touches only the preview', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('scoopaloo_save_v1', 'keep this campaign'))
  await page.goto('/shop-floor.html')
  await expect(page.locator('#hint')).toContainText('Drag to the cones')
  const picture = () => page.locator('canvas').evaluate(el => (el as HTMLCanvasElement).toDataURL())
  const before = await picture()
  await page.waitForTimeout(350)
  expect(await picture()).not.toBe(before)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(page.locator('#hint')).toContainText('Drag to the cones')
  const reduced = await picture()
  await page.waitForTimeout(350)
  expect(await picture()).toBe(reduced)
  await walk(page, { x: 150, y: 450 })
  await expect.poll(async () => (await snapshot(page)).player.cones).toBe(3)
  await page.getByRole('button', { name: 'Pause shop' }).click()
  await page.getByRole('button', { name: 'START A NEW SHOP', exact: true }).click()
  expect((await snapshot(page)).player.cones).toBe(3)
  await page.getByRole('button', { name: 'NEW SHOP? TAP AGAIN', exact: true }).click()
  expect((await snapshot(page)).player.cones).toBe(0)
  expect(await page.evaluate(() => localStorage.getItem('scoopaloo_save_v1'))).toBe('keep this campaign')
})

test('phone and tablet HUD is legible with no viewport overflow', async ({ page }) => {
  await page.goto('/shop-floor.html')
  for (const size of [{ width: 375, height: 667 }, { width: 430, height: 932 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(size)
    const layout = await page.evaluate(() => {
      const pause = document.querySelector('#pause')!.getBoundingClientRect()
      const hint = document.querySelector('#hint')!.getBoundingClientRect()
      const canvas = document.querySelector('canvas')!.getBoundingClientRect()
      return { width: document.documentElement.scrollWidth, inner: innerWidth,
        target: Math.min(pause.width, pause.height), hintInside: hint.bottom <= innerHeight,
        fullHeight: canvas.height === innerHeight }
    })
    expect(layout.width).toBe(layout.inner)
    expect(layout.target).toBeGreaterThanOrEqual(44)
    expect(layout.hintInside && layout.fullHeight).toBe(true)
  }
})
