import { defaultSave, type SaveV1 } from './engine'
import type { GameSkin } from './skin'

export const SAVE_KEY = 'scoopaloo_save_v1'
const PREFIX = 'sc1.'

export function loadSave(skin: GameSkin, storage: Pick<Storage, 'getItem'> = localStorage): SaveV1 {
  const fallback = defaultSave(skin)
  try {
    const parsed = JSON.parse(storage.getItem(SAVE_KEY) || '') as Partial<SaveV1>
    if (parsed.version !== 1) return fallback
    return migrateSave(skin, parsed)
  } catch {
    return fallback
  }
}

export function storeSave(save: SaveV1, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(SAVE_KEY, JSON.stringify({ ...save, text: true }))
}

export async function encodeSave(save: SaveV1): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify({ ...save, text: true }))
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return PREFIX + bytesToBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()))
}

export async function decodeSave(skin: GameSkin, code: string): Promise<SaveV1> {
  if (!code.startsWith(PREFIX)) throw new Error('unknown save code')
  const bytes = base64UrlToBytes(code.slice(PREFIX.length))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const parsed = JSON.parse(await new Response(stream).text()) as Partial<SaveV1>
  if (parsed.version !== 1 || !Number.isFinite(parsed.coins) || !Array.isArray(parsed.unlockedStations)) {
    throw new Error('invalid save')
  }
  return migrateSave(skin, parsed)
}

export async function rescueUrl(save: SaveV1): Promise<string> {
  return new URL(`/rescue.html#${await encodeSave(save)}`, location.origin).href
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function migrateSave(skin: GameSkin, parsed: Partial<SaveV1>): SaveV1 {
  const fallback = defaultSave(skin)
  const upgrades = parsed.upgrades && typeof parsed.upgrades === 'object' ? parsed.upgrades : {}
  return {
    version: 1,
    coins: Number.isFinite(parsed.coins) ? parsed.coins ?? 0 : 0,
    unlockedStations: Array.isArray(parsed.unlockedStations)
      ? parsed.unlockedStations.filter(value => typeof value === 'string')
      : fallback.unlockedStations,
    upgrades: { ...fallback.upgrades, ...upgrades },
    skin: typeof parsed.skin === 'string' ? parsed.skin : fallback.skin,
    text: true,
    bestRevenue: Number.isFinite(parsed.bestRevenue) ? Math.max(0, parsed.bestRevenue ?? 0) : 0,
    bestStars: Number.isFinite(parsed.bestStars) ? Math.max(0, Math.min(3, Math.floor(parsed.bestStars ?? 0))) : 0,
  }
}
