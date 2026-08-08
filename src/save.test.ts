import { describe, expect, it } from 'vitest'
import { defaultSave } from './engine'
import { decodeSave, encodeSave, loadSave, SAVE_KEY, storeSave } from './save'
import type { GameSkin } from './skin'
import skinData from './skins/ice-cream.json'

const skin = skinData as GameSkin

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
    const save = { ...defaultSave(skin), coins: 21, unlockedStations: [...skin.progression.startingStations, skin.upgrades[0].unlocks] }
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
      unlockedStations: [skin.progression.startingStation, skin.upgrades[0].unlocks],
      upgrades: { shoes: 1, tray: 0, machine: 0 },
      skin: skin.id,
      text: false,
    }))
    expect(loadSave(skin, storage)).toEqual({
      version: 1,
      coins: 37,
      unlockedStations: [
        skin.progression.startingStation,
        skin.upgrades[0].unlocks,
        skin.progression.startingStations[1],
      ],
      upgrades: { shoes: 1, tray: 0, machine: 0 },
      skin: skin.id,
      text: true,
      bestRevenue: 0,
      bestStars: 0,
    })
  })
})
