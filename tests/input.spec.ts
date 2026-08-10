import { expect, test } from '@playwright/test'

test('only consumes movement keys outside editable controls', async ({ page }) => {
  await page.goto('/')
  const prevented = await page.evaluate(() => {
    const press = (target: Window | HTMLElement, key: string, modifiers: KeyboardEventInit = {}) => {
      const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
      target.dispatchEvent(down)
      target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, ...modifiers }))
      return down.defaultPrevented
    }
    const input = document.body.appendChild(document.createElement('input'))
    return {
      wasd: press(window, 'w'),
      arrow: press(window, 'ArrowLeft'),
      other: press(window, 'r'),
      shortcut: press(window, 'w', { metaKey: true }),
      form: press(input, 'w'),
    }
  })

  expect(prevented).toEqual({ wasd: true, arrow: true, other: false, shortcut: false, form: false })
})

test('stops keyboard movement when the window loses focus', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  const startY = await page.evaluate(() => window.__scoopaloo.snapshot().player.y)
  await page.keyboard.down('w')
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().player.y)).toBeLessThan(startY - 5)
  const stoppedAt = await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
    return window.__scoopaloo.snapshot().player.y
  })
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().player.y)).toBeCloseTo(stoppedAt, 5)
  await page.keyboard.up('w')
})

test('held joystick anchor stays in CSS space while the live viewport changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const start = { x: 90, y: 500 }
  await page.evaluate(point => {
    const canvas = document.querySelector('canvas')!
    canvas.setPointerCapture = () => undefined
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 7,
      clientX: point.x,
      clientY: point.y,
      bubbles: true,
    }))
  }, start)
  await page.setViewportSize({ width: 768, height: 1024 })
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.viewport().cssWidth)).toBe(768)
  const anchor = await page.evaluate(() => {
    const view = window.__scoopaloo.viewport()
    const origin = window.__scoopaloo.joystickOrigin()!
    const rect = document.querySelector('canvas')!.getBoundingClientRect()
    return {
      x: rect.left + (origin.x - view.originX) * view.scale,
      y: rect.top + (origin.y - view.originY) * view.scale,
    }
  })
  await page.evaluate(point => document.querySelector('canvas')!.dispatchEvent(new PointerEvent('pointerup', {
    pointerId: 7,
    clientX: point.x,
    clientY: point.y,
    bubbles: true,
  })), start)

  expect(anchor.x).toBeCloseTo(start.x)
  expect(anchor.y).toBeCloseTo(start.y)
})
