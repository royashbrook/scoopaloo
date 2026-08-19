import { expect, test, type Page } from '@playwright/test'
import { defaultSave } from '../src/engine'
import { LOCKED_PRODUCER_PLAQUE, lockedProducerLabelFont } from '../src/render'
import { SAVE_KEY } from '../src/save'
import type { GameSkin } from '../src/skin'
import skinData from '../src/skins/ice-cream.json' with { type: 'json' }

const skin = skinData as GameSkin
const PHONES = [
  { name: '375', width: 375, height: 667 },
  { name: '390', width: 390, height: 844 },
  { name: '420', width: 420, height: 912 },
]
let saveSerial = 0

test.use({ hasTouch: true })

async function loadSave(page: Page, patch: Partial<ReturnType<typeof defaultSave>> = {}): Promise<void> {
  const marker = `kid-first-save-${++saveSerial}`
  await page.addInitScript(({ key, save, marker }) => {
    if (sessionStorage.getItem(marker)) return
    localStorage.setItem(key, JSON.stringify(save))
    sessionStorage.setItem(marker, 'loaded')
  }, {
    key: SAVE_KEY,
    save: { ...defaultSave(skin), ...patch },
    marker,
  })
  await page.goto(`/?${marker}`)
  await page.waitForFunction(() => window.__scoopaloo.atlasReady())
}

async function dragTo(page: Page, target: { x: number; y: number }): Promise<void> {
  const viewport = page.viewportSize()!
  const origin = { x: viewport.width / 2, y: viewport.height * .55 }
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  try {
    for (let tick = 0; tick < 350; tick++) {
      const next = await page.evaluate(goal => {
        const player = window.__scoopaloo.snapshot().player
        const dx = goal.x - player.x
        const dy = goal.y - player.y
        return { dx, dy, distance: Math.hypot(dx, dy) }
      }, target)
      if (next.distance < 52) return
      await page.mouse.move(origin.x + next.dx / next.distance * 64, origin.y + next.dy / next.distance * 64)
      await page.waitForTimeout(25)
    }
    throw new Error(`pointer route did not reach ${target.x},${target.y}`)
  } finally {
    await page.mouse.up()
  }
}

async function serveFront(page: Page, controlled = false): Promise<void> {
  const job = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const front = state.customers.find(customer => !customer.served && !customer.missed)!
    const direct = state.rules.intro!.directSources.find(source =>
      source.item === front.order.item && source.unlockAfterServes <= state.shift.served)!
    return {
      served: state.shift.served,
      item: front.order.item,
      source: state.skin.producers[direct.source].interaction,
      customer: {
        x: state.skin.stations.counter.interaction[0],
        y: state.skin.stations.counter.interaction[1],
      },
    }
  })
  await dragTo(page, { x: job.source[0], y: job.source[1] })
  await expect.poll(() => page.evaluate(item =>
    window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, job.item)).toBeGreaterThan(0)
  await dragTo(page, job.customer)
  if (controlled) {
    await page.evaluate(served => {
      const game = window.__scoopaloo
      game.pause(true)
      for (let tick = 0; tick < 30 && game.snapshot().shift.served === served; tick++) game.advance(.05)
    }, job.served)
  }
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().shift.served), {
    timeout: 4_000,
  }).toBe(job.served + 1)
}

async function expectSimpleFits(page: Page, name: string): Promise<void> {
  const layout = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect().toJSON()
    const fits = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)!
      return element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1
    }
    return {
      width: innerWidth,
      height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      hud: box('.shift-hud'),
      ticket: box('.order-ticket'),
      pause: box('[data-action="pause"]'),
      hudFits: fits('.shift-hud'),
      ticketFits: fits('.order-ticket'),
      pauseFits: fits('[data-action="pause"]'),
    }
  })
  expect(layout.documentWidth, `${name} has no horizontal page scroll`).toBeLessThanOrEqual(layout.width)
  expect(layout.hudFits, `${name} simple HUD content fits`).toBe(true)
  expect(layout.ticketFits, `${name} simple ticket content fits`).toBe(true)
  expect(layout.pauseFits, `${name} pause content fits`).toBe(true)
  expect(layout.hud.width, `${name} simple HUD stays compact`).toBeLessThanOrEqual(210)
  expect(layout.ticket.width, `${name} simple ticket stays compact`).toBeLessThanOrEqual(300)
  expect(layout.pause.width, `${name} pause remains tappable`).toBeGreaterThanOrEqual(44)
  expect(layout.pause.height, `${name} pause remains tappable`).toBeGreaterThanOrEqual(44)
  expect(layout.hud.right, `${name} HUD clears pause`).toBeLessThanOrEqual(layout.pause.left)
  expect(layout.ticket.top, `${name} ticket clears HUD`).toBeGreaterThanOrEqual(layout.hud.bottom)
  for (const [label, box] of Object.entries({ hud: layout.hud, ticket: layout.ticket, pause: layout.pause })) {
    expect(box.left, `${name} ${label} left`).toBeGreaterThanOrEqual(0)
    expect(box.top, `${name} ${label} top`).toBeGreaterThanOrEqual(0)
    expect(box.right, `${name} ${label} right`).toBeLessThanOrEqual(layout.width)
    expect(box.bottom, `${name} ${label} bottom`).toBeLessThanOrEqual(layout.height)
  }
}

test('first three orders are a protected, readable pointer tutorial on every phone width', async ({ page }) => {
  test.setTimeout(180_000)
  for (const phone of PHONES) {
    await page.setViewportSize({ width: phone.width, height: phone.height })
    await loadSave(page)

    await expect(page.locator('[data-field="ready-challenge"]'), phone.name)
      .toHaveText('DRAG TO MOVE · SERVE 3 CONES TO OPEN SUNDAES')
    await expect(page.locator('[data-field="ready-unlock"]'), phone.name).toHaveText('FIRST 3 ORDERS · NO TIMER')
    if (phone.name === '390') await page.screenshot({ path: 'test-results/kid-first-390-ready.png' })
    await page.getByRole('button', { name: 'START SHIFT' }).click()
    const lockedLabelWidths = await page.evaluate(({ family, labels, sizes }) => {
      const context = document.createElement('canvas').getContext('2d')!
      return Object.fromEntries(sizes.map(size => {
        const font = `900 ${size}px ${family}`
        context.font = font
        return [font, Object.fromEntries(labels.map(label => [label, context.measureText(label).width]))]
      }))
    }, {
      family: LOCKED_PRODUCER_PLAQUE.labelFontFamily,
      labels: ['1 MORE', '3 MORE', '9 MORE', 'DAY 2'],
      sizes: LOCKED_PRODUCER_PLAQUE.labelFontSizes,
    })
    for (const label of ['1 MORE', '3 MORE', '9 MORE', 'DAY 2']) {
      const font = lockedProducerLabelFont(label, (candidate, text) => lockedLabelWidths[candidate][text])
      expect(LOCKED_PRODUCER_PLAQUE.labelMaxWidth - lockedLabelWidths[font][label],
        `${phone.name} ${label} has real headroom`).toBeGreaterThanOrEqual(LOCKED_PRODUCER_PLAQUE.labelHeadroom)
    }
    await expect(page.locator('.shift-ui'), phone.name).toHaveAttribute('data-complexity', 'simple')
    await expect(page.locator('.hud-money'), phone.name).toBeVisible()
    await expect(page.locator('.hud-time'), phone.name).toBeHidden()
    await expect(page.locator('[data-field="combo-card"]'), phone.name).toBeHidden()
    await expect(page.locator('.next-orders'), phone.name).toBeHidden()
    await expect(page.locator('.patience-track'), phone.name).toBeHidden()
    await expect(page.locator('[data-field="order-payout"]'), phone.name).toBeHidden()
    await expect(page.locator('[data-field="ticket-guidance"]'), phone.name).toHaveText('DRAG ANYWHERE TO MOVE')
    await expect(page.locator('.recipe-list li'), phone.name).toHaveCount(1)
    await expectSimpleFits(page, phone.name)
    expect(await page.evaluate(() => window.__scoopaloo.snapshot().customers
      .filter(customer => !customer.served && !customer.missed).length), phone.name).toBe(1)

    const beforePause = await page.evaluate(() => {
      const state = window.__scoopaloo.snapshot()
      return { time: state.shift.remaining, patience: state.customers[0].patience }
    })
    await page.getByRole('button', { name: 'Pause shift' }).click()
    await expect(page.getByRole('heading', { name: 'SHIFT PAUSED' }), phone.name).toBeVisible()
    await page.waitForTimeout(250)
    expect(await page.evaluate(() => {
      const state = window.__scoopaloo.snapshot()
      return { time: state.shift.remaining, patience: state.customers[0].patience }
    }), phone.name).toEqual(beforePause)
    await page.getByRole('button', { name: 'RESUME' }).click()

    const protectedPressure = beforePause
    const start = await page.evaluate(() => window.__scoopaloo.snapshot().player)
    await dragTo(page, { x: start.x + 100, y: start.y })
    await expect(page.locator('[data-field="ticket-guidance"]'), phone.name)
      .toHaveText('WALK INTO VANILLA CONE RING')
    const firstItem = await page.evaluate(() => window.__scoopaloo.snapshot().customers[0].order.item)
    const source = await page.evaluate(item => {
      const state = window.__scoopaloo.snapshot()
      const direct = state.rules.intro!.directSources.find(candidate => candidate.item === item)!
      return state.skin.producers[direct.source].interaction
    }, firstItem)
    await dragTo(page, { x: source[0], y: source[1] })
    await expect.poll(() => page.evaluate(item =>
      window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, firstItem)).toBeGreaterThan(0)
    await expect(page.locator('[data-field="ticket-guidance"]'), phone.name).toHaveText('TAKE IT TO THE CUSTOMER')
    if (phone.name === '375' || phone.name === '390' || phone.name === '420') {
      await page.screenshot({ path: `test-results/kid-first-${phone.name}-carrying.png` })
    }
    expect(await page.evaluate(() => {
      const state = window.__scoopaloo.snapshot()
      return { time: state.shift.remaining, patience: state.customers[0].patience }
    }), phone.name).toEqual(protectedPressure)
    const firstCustomer = await page.evaluate(() => {
      const counter = window.__scoopaloo.snapshot().skin.stations.counter.interaction
      return { x: counter[0], y: counter[1] }
    })
    await dragTo(page, firstCustomer)
    await expect(page.locator('[data-field="ticket-guidance"]'), phone.name)
      .toHaveText('CUSTOMER IS GETTING IT')
    await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().shift.served)).toBe(1)

    for (let served = 1; served < 3; served++) {
      expect(await page.evaluate(() => {
        const game = window.__scoopaloo
        game.pause(true)
        if (!game.snapshot().customers.some(customer => !customer.served && !customer.missed)) game.advance(.05)
        const visible = game.snapshot().customers.some(customer => !customer.served && !customer.missed)
        game.pause(false)
        return visible
      }), `${phone.name} order ${served + 1} appears on the next step`).toBe(true)
      expect(await page.evaluate(() => {
        const state = window.__scoopaloo.snapshot()
        const front = state.customers.find(customer => !customer.served && !customer.missed)!
        return { time: state.shift.remaining, patience: front.patience }
      }), `${phone.name} protected order ${served + 1}`).toEqual(protectedPressure)
      await expect(page.locator('[data-field="ticket-guidance"]'), phone.name).toHaveText('GET THE VANILLA CONE')
      await serveFront(page, true)
      expect(await page.evaluate(() => window.__scoopaloo.snapshot().shift.remaining),
        `${phone.name} protected order ${served + 1} keeps shift time`).toBe(protectedPressure.time)
    }

    await expect(page.locator('.shift-ui'), phone.name).toHaveAttribute('data-complexity', 'standard')
    await expect(page.locator('.hud-time'), phone.name).toBeVisible()
    const postUnlock = await page.evaluate(() => {
      const game = window.__scoopaloo
      const before = game.snapshot().shift.remaining
      game.advance(.05)
      const state = game.snapshot()
      const front = state.customers.find(customer => !customer.served && !customer.missed)!
      return { item: front.order.item, elapsed: before - state.shift.remaining }
    })
    expect(postUnlock.item, phone.name).toBe('sundae')
    expect(postUnlock.elapsed, phone.name).toBeCloseTo(.05)
    await expect.poll(() => page.locator('[data-field="ticket-guidance"]').textContent())
      .toContain('SUNDAE')
    if (phone.name === '390') await page.screenshot({ path: 'test-results/kid-first-390-sundae-standard.png' })
    expect(await page.evaluate(() => window.__scoopaloo.snapshot().sources['sundae-cup']?.item), phone.name)
      .toBe('sundae')
  }
})

test('Day 2 restores crafting and the store reveals systems one day at a time', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await loadSave(page, { currentDay: 1, dayStars: [1, 0, 0] as [number, number, number] })
  await expect(page.locator('[data-field="ready-unlock"]'))
    .toHaveText('FIRST ORDER · NO TIMER · FOLLOW THE RECIPE')
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await expect(page.locator('.shift-ui')).toHaveAttribute('data-complexity', 'standard')
  await expect(page.locator('.hud-time')).toBeVisible()
  await expect(page.locator('.patience-track')).toBeVisible()
  await expect(page.locator('.recipe-list li')).toHaveCount(2)
  const dayTwo = await page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    const front = state.customers.find(customer => !customer.served && !customer.missed)!
    const recipe = state.skin.items[front.order.item].recipe!
    return {
      customerId: front.id,
      item: front.order.item,
      inputs: Object.entries(recipe.inputs).map(([item, quantity]) => {
        const source = Object.values(state.skin.producers).find(producer => producer.item === item)!
        return {
          item,
          label: state.skin.items[item].label,
          quantity,
          at: { x: source.interaction[0], y: source.interaction[1] },
        }
      }),
      prep: {
        x: state.skin.prepStations[recipe.station].interaction[0],
        y: state.skin.prepStations[recipe.station].interaction[1],
      },
      customer: {
        x: state.skin.stations.counter.interaction[0],
        y: state.skin.stations.counter.interaction[1],
      },
      activeSourceItems: Object.values(state.sources).map(source => source.item).sort(),
      pressure: { time: state.shift.remaining, patience: front.patience },
    }
  })
  expect(dayTwo.activeSourceItems).toEqual(['chocolate-scoop', 'cone-shell', 'soft-scoop', 'sundae-cup'])
  await page.screenshot({ path: 'test-results/kid-first-390-day2-guided.png' })
  await expect(page.locator('[data-field="ticket-guidance"]'))
    .toHaveText(`GET ${dayTwo.inputs.map(input => input.label).join(' + ')}`)
  for (const input of dayTwo.inputs) {
    const y = await page.evaluate(() => window.__scoopaloo.snapshot().player.y)
    await dragTo(page, { x: 480, y })
    await dragTo(page, { x: 480, y: input.at.y })
    await dragTo(page, input.at)
    await expect.poll(() => page.evaluate(item =>
      window.__scoopaloo.snapshot().player.trayItems[item.item] ?? 0, input)).toBe(input.quantity)
  }
  await dragTo(page, dayTwo.prep)
  await expect.poll(() => page.evaluate(item =>
    window.__scoopaloo.snapshot().player.trayItems[item] ?? 0, dayTwo.item), {
    timeout: 4_000,
  }).toBe(1)
  await expect(page.locator('[data-field="ticket-guidance"]')).toContainText(/COUNTER|DELIVER|SERVE/)
  await dragTo(page, dayTwo.customer)
  const protectedCraft = await page.evaluate(({ customerId }) => {
    const game = window.__scoopaloo
    game.pause(true)
    for (let tick = 0; tick < 30 && game.snapshot().shift.served === 0; tick++) game.advance(.05)
    const state = game.snapshot()
    const customer = state.customers.find(candidate => candidate.id === customerId)!
    return {
      served: state.shift.served,
      pressure: { time: state.shift.remaining, patience: customer.patience },
    }
  }, dayTwo)
  expect(protectedCraft).toEqual({ served: 1, pressure: dayTwo.pressure })
  const secondOrder = await page.evaluate(() => {
    const game = window.__scoopaloo
    const before = game.snapshot().shift.remaining
    game.advance(.05)
    const state = game.snapshot()
    const front = state.customers.find(customer => !customer.served && !customer.missed)!
    return { item: front.order.item, elapsed: before - state.shift.remaining }
  })
  expect(secondOrder.item).toBe('vanilla-cone')
  expect(secondOrder.elapsed).toBeCloseTo(.05)

  const cases = [
    { patch: { currentDay: 0 }, ids: ['shoes', 'tray'] },
    { patch: { currentDay: 1 }, ids: ['shoes', 'tray', 'machine', 'patience'] },
    { patch: { currentDay: 2 }, ids: ['shoes', 'tray', 'machine', 'patience', 'helper'] },
    {
      patch: { currentDay: 2, dayStars: [0, 0, 1] as [number, number, number] },
      ids: ['shoes', 'tray', 'machine', 'patience', 'helper', 'second-counter'],
    },
    {
      patch: {
        currentDay: 2,
        dayStars: [0, 0, 1] as [number, number, number],
        upgrades: { ...defaultSave(skin).upgrades, 'second-counter': 1 },
      },
      ids: ['shoes', 'tray', 'machine', 'patience', 'helper', 'second-counter', 'counter-runner'],
    },
  ]
  for (const entry of cases) {
    await loadSave(page, entry.patch)
    await page.getByRole('button', { name: 'STORE' }).click()
    await expect(page.locator('[data-upgrade-card]')).toHaveCount(entry.ids.length)
    expect(await page.locator('[data-upgrade-card]').evaluateAll(cards =>
      cards.map(card => (card as HTMLElement).dataset.upgradeCard))).toEqual(entry.ids)
  }

  await loadSave(page, {
    currentDay: 1,
    upgrades: { ...defaultSave(skin).upgrades, helper: 1 },
  })
  await expect(page.locator('canvas')).not.toHaveAttribute('aria-describedby')
  await expect(page.locator('#helper-status')).toHaveText('')
  await expect(page.locator('#runner-status')).toHaveText('')
  await page.getByRole('button', { name: 'STORE' }).click()
  await expect(page.locator('[data-upgrade-card="helper"]')).toHaveCount(0)
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().save.upgrades.helper)).toBe(1)
  await page.locator('[data-action="back"]').click()
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await page.evaluate(() => {
    window.__scoopaloo.pause(true)
    window.__scoopaloo.advance(30)
  })
  expect(await page.evaluate(() => window.__scoopaloo.snapshot().events
    .some(event => event.source === 'helper'))).toBe(false)
  await expect(page.locator('#helper-status')).toHaveText('')
})

test('a mastered Day 1 reload and retry keep the finished-product source model', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loadSave(page, { dayStars: [1, 0, 0] as [number, number, number] })
  await page.reload()

  const sourceModel = () => page.evaluate(() => {
    const state = window.__scoopaloo.snapshot()
    return {
      protectedServes: state.rules.intro?.protectedServes,
      guidedServes: state.rules.intro?.guidedServes,
      coneSource: state.sources['soft-scoop']?.item,
      hasRawConeSource: Boolean(state.sources['cone-shell']),
    }
  })
  const expected = {
    protectedServes: 0,
    guidedServes: 0,
    coneSource: 'vanilla-cone',
    hasRawConeSource: false,
  }
  expect(await sourceModel()).toEqual(expected)

  await page.getByRole('button', { name: 'START SHIFT' }).click()
  await page.evaluate(() => {
    const game = window.__scoopaloo
    game.pause(true)
    game.advance(game.snapshot().shift.remaining)
  })
  await expect(page.getByRole('button', { name: 'RETRY' })).toBeVisible()
  await page.getByRole('button', { name: 'RETRY' }).click()
  await expect.poll(() => page.evaluate(() => window.__scoopaloo.snapshot().phase)).toBe('playing')
  expect(await sourceModel()).toEqual(expected)
})

test('a two-item direct order asks for the remainder before delivery', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loadSave(page, { coins: 1, lifetimeCash: 1 })
  await page.getByRole('button', { name: 'START SHIFT' }).click()
  const order = await page.evaluate(() => {
    const game = window.__scoopaloo
    const point = (values: number[]) => ({ x: values[0], y: values[1] })
    game.pause(true)
    for (let tick = 0; tick < 500 && game.snapshot().shift.served < 4; tick++) {
      const state = game.snapshot()
      const front = state.customers.find(customer => !customer.served && !customer.missed)
      if (!front) { game.advance(.2); continue }
      const direct = state.rules.intro!.directSources.find(source =>
        source.item === front.order.item && source.unlockAfterServes <= state.shift.served)!
      const before = state.shift.served
      for (let made = 0; made < front.order.quantity; made++) {
        const target = (game.snapshot().player.trayItems[front.order.item] ?? 0) + 1
        game.movePlayer(point(state.skin.producers[direct.source].interaction))
        for (let step = 0; step < 30
          && (game.snapshot().player.trayItems[front.order.item] ?? 0) < target; step++) game.advance(.2)
        game.movePlayer(point(state.skin.stations.counter.interaction))
        for (let step = 0; step < 30 && game.snapshot().shift.served === before; step++) game.advance(.1)
      }
      game.movePlayer({ x: 480, y: 880 })
      game.advance(.1)
    }
    for (let tick = 0; tick < 100
      && !game.snapshot().customers.some(customer => !customer.served && !customer.missed); tick++) game.advance(.2)
    const state = game.snapshot()
    const front = state.customers.find(customer => !customer.served && !customer.missed)!
    return { item: front.order.item, label: front.order.label, quantity: front.order.quantity }
  })
  expect(order).toMatchObject({ item: 'sundae', label: 'VANILLA SUNDAE', quantity: 2 })

  await page.evaluate(item => window.__scoopaloo.stockCounter({ [item]: 1 }), order.item)
  await expect(page.locator('[data-field="ticket-guidance"]')).toHaveText('GET THE VANILLA SUNDAE')
  await expect(page.locator('.recipe-list li')).toContainText('1/2')

  await page.evaluate(item => {
    const game = window.__scoopaloo
    game.stockCounter({})
    const state = game.snapshot()
    const direct = state.rules.intro!.directSources.find(source => source.item === item)!
    game.movePlayer({
      x: state.skin.producers[direct.source].interaction[0],
      y: state.skin.producers[direct.source].interaction[1],
    })
    for (let tick = 0; tick < 30 && (game.snapshot().player.trayItems[item] ?? 0) === 0; tick++) game.advance(.2)
    game.movePlayer({ x: 480, y: 880 })
  }, order.item)
  await expect(page.locator('[data-field="ticket-guidance"]')).toHaveText('TAKE IT TO THE CUSTOMER')
  await expect(page.locator('.recipe-list li')).toContainText('1/2')
})
