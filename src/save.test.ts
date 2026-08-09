import { describe, expect, it } from 'vitest'
import { createGame, defaultSave, startShift, step } from './engine'
import { decodeSave, encodeSave, loadSave, SAVE_KEY, storeSave } from './save'
import type { GameSkin } from './skin'
import skinData from './skins/ice-cream.json'

const skin = skinData as GameSkin
const legacyUnlock = 'speedy-sneakers'

describe('save v1', () => {
  it('round trips local storage', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    const save = { ...defaultSave(skin), coins: 12, bestRevenue: 74, bestStars: 2 }
    save.upgrades.helper = 2
    storeSave(save, storage)
    expect(values.has(SAVE_KEY)).toBe(true)
    expect(loadSave(skin, storage)).toMatchObject({
      coins: 12, text: true, bestRevenue: 74, bestStars: 2, upgrades: { helper: 2 },
    })
  })

  it('falls back cleanly when browser storage is unavailable', () => {
    const fallback = defaultSave(skin)
    expect(loadSave(skin, { getItem: () => { throw new DOMException('denied', 'SecurityError') } })).toEqual(fallback)
    expect(storeSave(fallback, { setItem: () => { throw new DOMException('full', 'QuotaExceededError') } })).toBe(false)
  })

  it('migrates partial local saves without requiring rescue-code fields', () => {
    const restored = loadSave(skin, { getItem: () => JSON.stringify({
      version: 1,
      currentDay: 2,
      dayStars: [1, 2, 3],
      dayBestRevenue: [54, 66, 143],
    }) })
    expect(restored).toMatchObject({
      coins: 0,
      currentDay: 2,
      dayStars: [1, 2, 3],
      dayBestRevenue: [54, 66, 143],
      unlockedStations: skin.progression.startingStations,
    })
  })

  it('round trips an sc1 deflate-raw code', async () => {
    const save = {
      ...defaultSave(skin),
      coins: 21,
      lifetimeCash: 21,
      currentDay: 2,
      scoreChaseLevel: 5,
      scoreChaseBest: 248,
      unlockedStations: [...skin.progression.startingStations, legacyUnlock],
    }
    save.upgrades.helper = 2
    const code = await encodeSave(save)
    expect(code.startsWith('sc1.')).toBe(true)
    expect(await decodeSave(skin, code)).toEqual(save)
  })

  it('decodes an older sc1 rescue payload with additive defaults', async () => {
    const legacy = {
      version: 1,
      coins: 19,
      unlockedStations: [skin.progression.startingStation],
      upgrades: { shoes: 1, tray: 0, machine: 0 },
      skin: skin.id,
      text: false,
    } as unknown as ReturnType<typeof defaultSave>
    const restored = await decodeSave(skin, await encodeSave(legacy))
    expect(restored).toMatchObject({
      version: 1,
      coins: 19,
      unlockedStations: skin.progression.startingStations,
      upgrades: { shoes: 1, tray: 0, machine: 0, helper: 0 },
      text: true,
      bestRevenue: 0,
      bestStars: 0,
      scoreChaseLevel: 0,
      scoreChaseBest: 0,
    })
  })

  it('adds result records to an existing v1 save without losing progress', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    values.set(SAVE_KEY, JSON.stringify({
      version: 1,
      coins: 37,
      unlockedStations: [skin.progression.startingStation, legacyUnlock],
      upgrades: { shoes: 1, tray: 0, machine: 0 },
      skin: skin.id,
      text: false,
    }))
    expect(loadSave(skin, storage)).toEqual({
      version: 1,
      coins: 37,
      unlockedStations: [
        skin.progression.startingStation,
        legacyUnlock,
        ...skin.progression.startingStations.slice(1),
      ],
      upgrades: { shoes: 1, tray: 0, machine: 0, patience: 0, helper: 0 },
      skin: skin.id,
      text: true,
      bestRevenue: 0,
      bestStars: 0,
      currentDay: 0,
      lifetimeCash: 37,
      dayStars: [0, 0, 0],
      dayBestRevenue: [0, 0, 0],
      scoreChaseLevel: 0,
      scoreChaseBest: 0,
    })
  })

  it('migrates campaign fields without losing unknown station or upgrade history', () => {
    const values = new Map<string, string>()
    values.set(SAVE_KEY, JSON.stringify({
      version: 1,
      coins: 42,
      unlockedStations: ['retired-cart'],
      upgrades: { shoes: 8, tray: -2, machine: 1, helper: 8, 'retired-upgrade': 2 },
      skin: skin.id,
      bestRevenue: 74,
      bestStars: 2,
      currentDay: 99,
    }))
    const restored = loadSave(skin, { getItem: key => values.get(key) ?? null })
    expect(restored).toMatchObject({
      coins: 42,
      currentDay: 2,
      lifetimeCash: 42,
      dayStars: [2, 0, 0],
      dayBestRevenue: [74, 0, 0],
      upgrades: { shoes: 3, tray: 0, machine: 1, patience: 0, helper: 3, 'retired-upgrade': 2 },
    })
    expect(restored.unlockedStations).toEqual(['retired-cart', ...skin.progression.startingStations])
  })

  it('backfills only proven legacy Day 3 completion into Rush 1', () => {
    const restore = (value: object) => loadSave(skin, {
      getItem: () => JSON.stringify({
        ...defaultSave(skin),
        scoreChaseLevel: undefined,
        scoreChaseBest: undefined,
        ...value,
      }),
    })

    expect(restore({ currentDay: 2 }).scoreChaseLevel).toBe(0)
    expect(restore({ currentDay: 2, dayStars: [1, 2, 1] })).toMatchObject({
      currentDay: 2,
      scoreChaseLevel: 1,
      scoreChaseBest: 0,
    })
    expect(restore({ currentDay: 0, dayBestRevenue: [0, 0, skin.days[2].cashGoal] })).toMatchObject({
      currentDay: 2,
      scoreChaseLevel: 1,
    })

    const explicitCampaign = restore({ currentDay: 2, dayStars: [1, 2, 1], scoreChaseLevel: 0 })
    expect(explicitCampaign.scoreChaseLevel).toBe(0)
  })

  it('sanitizes corrupt rush fields without losing unknown history', () => {
    const restored = loadSave(skin, { getItem: () => JSON.stringify({
      ...defaultSave(skin),
      unlockedStations: ['retired-cart'],
      upgrades: { ...defaultSave(skin).upgrades, helper: -7, 'retired-upgrade': 2 },
      scoreChaseLevel: -9,
      scoreChaseBest: -400,
    }) })
    expect(restored).toMatchObject({
      scoreChaseLevel: 0,
      scoreChaseBest: 0,
      upgrades: { helper: 0, 'retired-upgrade': 2 },
    })
    expect(restored.unlockedStations).toEqual(['retired-cart', ...skin.progression.startingStations])

    const overflow = JSON.stringify(defaultSave(skin))
      .replace('"scoreChaseLevel":0', '"scoreChaseLevel":1e999')
      .replace('"scoreChaseBest":0', '"scoreChaseBest":1e999')
    expect(loadSave(skin, { getItem: () => overflow })).toMatchObject({
      scoreChaseLevel: 0,
      scoreChaseBest: 0,
    })
  })

  it('round trips a finished rush without touching campaign records', () => {
    const save = defaultSave(skin)
    Object.assign(save, {
      currentDay: 2,
      scoreChaseLevel: 1,
      bestRevenue: 195,
      bestStars: 3,
      dayStars: [1, 2, 3],
      dayBestRevenue: [54, 65, 195],
    })
    const game = createGame(skin, save)
    startShift(game)
    game.shift.revenue = 220
    game.shift.remaining = .01
    step(game, .01)

    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    storeSave(game.save, storage)
    expect(loadSave(skin, storage)).toMatchObject({
      currentDay: 2,
      scoreChaseLevel: 1,
      scoreChaseBest: 220,
      bestRevenue: 195,
      bestStars: 3,
      dayStars: [1, 2, 3],
      dayBestRevenue: [54, 65, 195],
    })
  })
})
