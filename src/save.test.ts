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
    const save = { ...defaultSave(skin), coins: 12 }
    storeSave(save, storage)
    expect(values.has(SAVE_KEY)).toBe(true)
    expect(loadSave(skin, storage).coins).toBe(12)
  })

  it('round trips an sc1 deflate-raw code', async () => {
    const save = { ...defaultSave(skin), coins: 21, unlockedStations: [skin.progression.startingStation, skin.progression.firstBuildUnlock] }
    const code = await encodeSave(save)
    expect(code.startsWith('sc1.')).toBe(true)
    expect(await decodeSave(skin, code)).toEqual(save)
  })
})
