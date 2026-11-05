/**
 * Custom accent colours.
 *
 * The eight built-in palettes in styles.css ship hand-tuned lightness values for
 * text and fills. A colour picked with `input[type=color]` has no such tuning, so
 * the same tokens are derived here: the fill keeps the picked colour, the *text*
 * shade is nudged until it clears WCAG AA on the real surface, and filled
 * controls get whichever label (near-white or near-black) reads better on it —
 * that is the "invert the label when contrast is low" behaviour.
 */
export type Hsl = { h: number; s: number; l: number }

const SURFACE_LIGHT = '#ffffff'
const SURFACE_LIGHT_SOFT = '#eef3f9'
const SURFACE_DARK = '#121a25'

export function parseHex(value: string | undefined | null): string {
  const text = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : ''
}

export function hexToRgb(hex: string): [number, number, number] {
  const text = parseHex(hex) || '#000000'
  return [
    parseInt(text.slice(1, 3), 16),
    parseInt(text.slice(3, 5), 16),
    parseInt(text.slice(5, 7), 16),
  ]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`
}

export function hexToHsl(hex: string): Hsl {
  const [r255, g255, b255] = hexToRgb(hex)
  const r = r255 / 255
  const g = g255 / 255
  const b = b255 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60
      break
    case g:
      h = ((b - r) / d + 2) * 60
      break
    default:
      h = ((r - g) / d + 4) * 60
  }
  return { h, s, l }
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sat = Math.max(0, Math.min(1, s))
  const light = Math.max(0, Math.min(1, l))
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = light - c / 2
  let rgb: [number, number, number]
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255)
}

function channelLuminance(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g)
    + 0.0722 * channelLuminance(b)
}

export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Push the lightness of `hsl` until it reaches `target` contrast on `surface`. */
function tuneForSurface(hsl: Hsl, surface: string, target = 4.6): Hsl {
  const background = luminance(surface)
  let { l } = hsl
  const step = background > 0.4 ? -0.015 : 0.015
  for (let i = 0; i < 80; i += 1) {
    const candidate = { ...hsl, l }
    if (contrast(hslToHex(candidate), surface) >= target) return candidate
    l += step
    if (l < 0.04 || l > 0.96) break
  }
  return { ...hsl, l: Math.max(0.04, Math.min(0.96, l)) }
}

/** Near-white or near-black label for a filled control of `hex`. */
export function readableOn(hex: string): string {
  return contrast(hex, '#ffffff') >= contrast(hex, '#0b1220') ? '#ffffff' : '#0b1220'
}

/**
 * Same hue, nudged until it reads on `surface`. Used for a text colour the
 * operator picked for a row that has no background of its own: a pale amber
 * stays pale amber on a dark row, and darkens on a white one.
 */
export function readableVariant(color: string, surface: string, target = 4.5): string {
  const hex = parseHex(color)
  const background = parseHex(surface)
  if (!hex || !background) return color
  if (contrast(hex, background) >= target) return hex
  return hslToHex(tuneForSurface(hexToHsl(hex), background, target))
}

/** What an untinted row is really painted on, per theme (see --msv-table-sticky). */
export function rowSurface(root?: HTMLElement): string {
  const element = root || (typeof document === 'undefined' ? null : document.documentElement)
  return element && element.classList.contains('dark') ? SURFACE_DARK : SURFACE_LIGHT
}

/**
 * Write the accent tokens for a custom colour on <html>. Inline variables beat
 * every `[data-accent]` block in the stylesheet, and clearing them (passing "")
 * hands control back to the selected preset.
 */
export function applyCustomAccent(root: HTMLElement, hex: string): void {
  const color = parseHex(hex)
  if (!color) {
    root.removeAttribute('data-accent-custom')
    for (const key of [
      '--msv-h', '--msv-s', '--msv-l-text', '--msv-l-fill',
      '--msv-d-text', '--msv-d-fill', '--msv-solid-fg',
    ]) {
      root.style.removeProperty(key)
    }
    return
  }
  const hsl = hexToHsl(color)
  const light = tuneForSurface({ ...hsl }, SURFACE_LIGHT)
  const lightSoft = tuneForSurface({ ...hsl }, SURFACE_LIGHT_SOFT)
  const dark = tuneForSurface({ ...hsl }, SURFACE_DARK)
  root.setAttribute('data-accent', 'custom')
  root.setAttribute('data-accent-custom', 'true')
  root.style.setProperty('--msv-h', hsl.h.toFixed(1))
  root.style.setProperty('--msv-s', `${(hsl.s * 100).toFixed(1)}%`)
  // Text shades must read on the page background; fills keep the picked colour.
  root.style.setProperty('--msv-l-text', `${(Math.min(light.l, lightSoft.l) * 100).toFixed(1)}%`)
  root.style.setProperty('--msv-l-fill', `${(hsl.l * 100).toFixed(1)}%`)
  root.style.setProperty('--msv-d-text', `${(dark.l * 100).toFixed(1)}%`)
  root.style.setProperty('--msv-d-fill', `${(hsl.l * 100).toFixed(1)}%`)
  // "相对反色": pick the label by measured contrast, not by theme.
  root.style.setProperty('--msv-solid-fg', readableOn(color))
}
