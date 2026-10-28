/**
 * System font discovery.
 *
 * Chromium exposes `queryLocalFonts()` behind a user gesture and a permission
 * prompt, so it is only tried when the user clicks "read installed fonts".
 * Everything else falls back to a curated list of families that ship with
 * Windows (plus a couple of common developer fonts).
 */

export interface FontOption {
  value: string
  label: string
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<{ family: string }[]>
  }
}

/** Always offered: these exist on every Windows install we target. */
export const FALLBACK_UI_FONTS = [
  'Microsoft YaHei UI',
  'Microsoft YaHei',
  'Segoe UI',
  'Segoe UI Variable Text',
  'PingFang SC',
  'Hiragino Sans GB',
  'Source Han Sans SC',
  'Noto Sans SC',
  'SimHei',
  'SimSun',
  'KaiTi',
  'FangSong',
  'YouYuan',
  'Tahoma',
  'Verdana',
  'Arial',
]

export const FALLBACK_CODE_FONTS = [
  'Cascadia Mono',
  'Cascadia Code',
  'JetBrains Mono',
  'Fira Code',
  'IBM Plex Mono',
  'Consolas',
  'Menlo',
  'DejaVu Sans Mono',
  'Sarasa Mono SC',
  'Maple Mono',
  'LXGW WenKai Mono',
  'Courier New',
  'NSimSun',
  'SimSun',
]

const SYSTEM_DEFAULT = ''

export function withDefault(families: string[], defaultLabel: string): FontOption[] {
  return [
    { value: SYSTEM_DEFAULT, label: defaultLabel },
    ...[...new Set(families.filter(Boolean))].map((family) => ({ value: family, label: family })),
  ]
}

let cached: string[] | null = null

/** True when the browser can enumerate real fonts. */
export function canReadSystemFonts(): boolean {
  return typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function'
}

/**
 * Ask the OS for its font list. Must run from a click: the API is gated behind
 * a permission prompt and throws otherwise.
 */
export async function readSystemFonts(): Promise<string[]> {
  if (cached) return cached
  if (!canReadSystemFonts()) return []
  try {
    const fonts = await window.queryLocalFonts!()
    const families = [...new Set(fonts.map((font) => font.family).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )
    cached = families
    return families
  } catch {
    // Denied or unsupported — the caller keeps the curated list.
    return []
  }
}

export function mergeFonts(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter(Boolean))]
}
