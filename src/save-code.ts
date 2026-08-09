export const SAVE_KEY = 'scoopaloo_save_v1'
export const SAVE_PREFIX = 'sc1.'

export type SaveRecord = Record<string, unknown> & {
  version: 1
  coins: number
  unlockedStations: unknown[]
}

export function parseSaveRecord(value: string): SaveRecord {
  return validateSaveRecord(JSON.parse(value))
}

export async function encodeSaveCode(save: unknown): Promise<string> {
  const input = new TextEncoder().encode(JSON.stringify(save))
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return SAVE_PREFIX + bytesToBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()))
}

export async function decodeSaveCode(code: string): Promise<SaveRecord> {
  if (!code.startsWith(SAVE_PREFIX)) throw new Error('unknown save code')
  const bytes = base64UrlToBytes(code.slice(SAVE_PREFIX.length))
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return parseSaveRecord(await new Response(stream).text())
}

function validateSaveRecord(value: unknown): SaveRecord {
  if (!value || typeof value !== 'object') throw new Error('invalid save')
  const save = value as Partial<SaveRecord>
  if (save.version !== 1 || !Number.isFinite(save.coins) || !Array.isArray(save.unlockedStations)) {
    throw new Error('invalid save')
  }
  return save as SaveRecord
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
