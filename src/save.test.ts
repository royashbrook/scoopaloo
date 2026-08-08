import { describe, expect, it } from 'vitest'
import { defaultSave } from './engine'
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
    storeSave(save, storage)
    expect(values.has(SAVE_KEY)).toBe(true)
    expect(loadSave(skin, storage)).toMatchObject({ coins: 12, text: true, bestRevenue: 74, bestStars: 2 })
  })

  it('round trips an sc1 deflate-raw code', async () => {
    const save = { ...defaultSave(skin), coins: 21, lifetimeCash: 21, unlockedStations: [...skin.progression.startingStations, legacyUnlock] }
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
      upgrades: { shoes: 1, tray: 0, machine: 0 },
      text: true,
      bestRevenue: 0,
      bestStars: 0,
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
      upgrades: { shoes: 1, tray: 0, machine: 0, patience: 0 },
      skin: skin.id,
      text: true,
      bestRevenue: 0,
      bestStars: 0,
      currentDay: 0,
      lifetimeCash: 37,
      dayStars: [0, 0, 0],
      dayBestRevenue: [0, 0, 0],
    })
  })

  it('migrates campaign fields without losing unknown station or upgrade history', () => {
    const values = new Map<string, string>()
    values.set(SAVE_KEY, JSON.stringify({
      version: 1,
      coins: 42,
      unlockedStations: ['retired-cart'],
      upgrades: { shoes: 8, tray: -2, machine: 1, 'retired-upgrade': 2 },
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
      upgrades: { shoes: 3, tray: 0, machine: 1, patience: 0, 'retired-upgrade': 2 },
    })
    expect(restored.unlockedStations).toEqual(['retired-cart', ...skin.progression.startingStations])
  })
})
