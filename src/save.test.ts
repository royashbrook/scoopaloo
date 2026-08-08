import { describe, expect, it } from 'vitest'
import { defaultSave } from './engine'
import { decodeSave, encodeSave, loadSave, SAVE_KEY, storeSave } from './save'

describe('save v1', () => {
  it('round trips local storage', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    const save = { ...defaultSave(), coins: 12 }
    storeSave(save, storage)
    expect(values.has(SAVE_KEY)).toBe(true)
    expect(loadSave(storage).coins).toBe(12)
  })

  it('round trips an sc1 deflate-raw code', async () => {
    const save = { ...defaultSave(), coins: 21, unlockedStations: ['soft-serve', 'sundae-cart'] }
    const code = await encodeSave(save)
    expect(code.startsWith('sc1.')).toBe(true)
    expect(await decodeSave(code)).toEqual(save)
  })
})
