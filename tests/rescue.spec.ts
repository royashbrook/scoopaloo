import { expect, test, type Page } from '@playwright/test'
import { defaultSave } from '../src/engine'
import { encodeSave, SAVE_KEY } from '../src/save'
import type { GameSkin } from '../src/skin'
import skinData from '../src/skins/ice-cream.json' with { type: 'json' }

const skin = skinData as GameSkin

async function seedSave(page: Page, save: object): Promise<void> {
  await page.addInitScript(({ key, value }) => {
    const marker = 'scoopaloo-rescue-test-seeded'
    if (sessionStorage.getItem(marker)) return
    localStorage.setItem(key, JSON.stringify(value))
    sessionStorage.setItem(marker, '1')
  }, { key: SAVE_KEY, value: save })
}

test('names and explains the phone save-transfer dialog', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 912 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open save card' }).click()
  const dialog = page.getByRole('dialog', { name: 'MOVE YOUR SAVE' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('SCAN THE CODE OR OPEN THE RESCUE LINK ON YOUR OTHER DEVICE.')).toBeVisible()
  const link = dialog.getByRole('link', { name: 'OPEN RESCUE LINK' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', /\/rescue\.html#sc1\./)
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(420)
  expect(box!.y + box!.height).toBeLessThanOrEqual(912)
})

test('requires a second matching confirmation before replacing richer progress', async ({ page }) => {
  const current = { ...defaultSave(skin), coins: 55, lifetimeCash: 240, currentDay: 2 }
  const incoming = { ...defaultSave(skin), coins: 12, lifetimeCash: 80 }
  const code = await encodeSave(incoming)

  await seedSave(page, current)
  await page.goto(`/rescue.html#${code}`)
  await page.getByRole('button', { name: 'RESTORE SAVE' }).click()

  await expect(page.getByText('CURRENT SAVE HAS MORE PROGRESS')).toBeVisible()
  await expect(page.getByText('CURRENT COINS').locator('..')).toContainText('$55')
  await expect(page.getByText('RESCUE COINS').locator('..')).toContainText('$12')
  await expect(page.getByRole('button')).toHaveText('REPLACE CURRENT SAVE')
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY)).toEqual(current)

  await page.getByRole('button', { name: 'REPLACE CURRENT SAVE' }).click()
  await expect(page.getByText('SAVE RESTORED')).toBeVisible()
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY)).toEqual({ ...incoming, text: true })
})

test('does not treat simultaneous taps as the richer-save confirmation', async ({ page }) => {
  const current = { ...defaultSave(skin), coins: 70, lifetimeCash: 400 }
  const incoming = { ...defaultSave(skin), coins: 5, lifetimeCash: 20 }
  const code = await encodeSave(incoming)

  await seedSave(page, current)
  await page.goto(`/rescue.html#${code}`)
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('#restore')!
    button.click()
    button.click()
  })

  await expect(page.getByText('CURRENT SAVE HAS MORE PROGRESS')).toBeVisible()
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY)).toEqual(current)
})

test('re-arms confirmation if the current save changes between taps', async ({ page }) => {
  const current = { ...defaultSave(skin), coins: 20, lifetimeCash: 100 }
  const newer = { ...current, coins: 80, lifetimeCash: 300 }
  const incoming = { ...defaultSave(skin), coins: 10, lifetimeCash: 50 }
  const code = await encodeSave(incoming)

  await seedSave(page, current)
  await page.goto(`/rescue.html#${code}`)
  await page.getByRole('button').click()
  await expect(page.getByText('CURRENT SAVE HAS MORE PROGRESS')).toBeVisible()
  await page.evaluate(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), { key: SAVE_KEY, save: newer })
  await page.getByRole('button').click()

  await expect(page.locator('#comparison')).toBeVisible()
  await expect(page.getByText('CURRENT COINS').locator('..')).toContainText('$80')
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY)).toEqual(newer)
  await page.getByRole('button').click()
  await expect(page.getByText('SAVE RESTORED')).toBeVisible()
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), SAVE_KEY)).toEqual({ ...incoming, text: true })
})

test('restores equal or richer rescue progress once from the generated shared codec', async ({ page }) => {
  const current = { ...defaultSave(skin), coins: 8, lifetimeCash: 20 }
  const incoming = { ...defaultSave(skin), coins: 41, lifetimeCash: 90, currentDay: 1 }
  const code = await encodeSave(incoming)

  await seedSave(page, current)
  await page.goto(`/rescue.html#${code}`)
  await page.getByRole('button').click()
  await expect(page.getByText('SAVE RESTORED')).toBeVisible()

  const html = await (await page.request.get('/rescue.html')).text()
  expect(html).not.toContain('__SCOOPALOO_SAVE_CODE__')
  expect(html).toContain('async function decodeSaveCode')
  expect(html).not.toMatch(/<script[^>]+src=/)

  await page.getByRole('link', { name: 'PLAY SCOOPALOO' }).click()
  await expect.poll(() => page.evaluate(() => window.__scoopaloo?.snapshot().save.currentDay ?? -1)).toBe(1)
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().save.lifetimeCash)).toBe(90)
})
