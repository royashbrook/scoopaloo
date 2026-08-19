import { expect, test } from '@playwright/test'
import { defaultSave } from '../src/engine'
import { SAVE_KEY } from '../src/save'
import type { GameSkin } from '../src/skin'
import skinData from '../src/skins/ice-cream.json' with { type: 'json' }

const skin = skinData as GameSkin

test('boots without storage access and keeps playing when autosave is denied', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => { throw new DOMException('denied', 'SecurityError') },
    })
  })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => Boolean(window.__scoopaloo))).toBe(true)
  await page.evaluate(() => window.__scoopaloo.startShift())
  await page.waitForTimeout(1400)
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().time)).toBeGreaterThan(1.1)
  expect(errors).toEqual([])
})

test('continues the frame loop after a quota failure', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
  })
  await page.goto('/')
  await page.evaluate(() => window.__scoopaloo.startShift())
  await page.waitForTimeout(1600)
  const first = await page.evaluate(() => window.__scoopaloo.snapshot().time)
  await page.waitForTimeout(350)
  const second = await page.evaluate(() => window.__scoopaloo.snapshot().time)
  expect(first).toBeGreaterThan(1.2)
  expect(second - first).toBeGreaterThan(.2)
  expect(errors).toEqual([])
})

test('closing a stale tab cannot replace newer progress', async ({ context, page }) => {
  const initial = { ...defaultSave(skin), coins: 500, lifetimeCash: 1_500 }
  await page.addInitScript(({ key, save }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(save))
  }, { key: SAVE_KEY, save: initial })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => Boolean(window.__scoopaloo))).toBe(true)

  const played = await context.newPage()
  await played.goto('/')
  await played.getByRole('button', { name: 'STORE' }).click()
  const shoes = played.locator('[data-upgrade-card="shoes"]')
  await shoes.getByRole('button').click()
  await expect(shoes).toHaveAttribute('data-level', '1')
  const playedSave = await played.evaluate(key => JSON.parse(localStorage.getItem(key)!), SAVE_KEY)
  expect(playedSave).toMatchObject({ coins: 475, lifetimeCash: 1_500, upgrades: { shoes: 1 } })
  await played.goto('/rescue.html')

  await page.evaluate(() => addEventListener('pagehide', () => localStorage.setItem('scoopaloo-pagehide-proof', '1'), { once: true }))
  await page.close({ runBeforeUnload: true })
  await expect.poll(() => page.isClosed()).toBe(true)
  expect(await played.evaluate(() => localStorage.getItem('scoopaloo-pagehide-proof'))).toBe('1')
  expect(await played.evaluate(key => JSON.parse(localStorage.getItem(key)!), SAVE_KEY)).toEqual(playedSave)

  await played.goto('/')
  await expect.poll(() => played.evaluate(() => window.__scoopaloo.snapshot().save.upgrades.shoes)).toBe(1)
})
