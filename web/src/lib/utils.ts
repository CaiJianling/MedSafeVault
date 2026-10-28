import { formatMonthYear, translate } from './i18n'
import type { Column } from './types'

const MONO_HINTS =
  /(端口|地址|网址|域名|链接|ip|host|hostname|port|url|uri|user|username|account|login|账号|用户名|数据库|实例|instance|serial|序列号|编号)/i

/** Technical columns (ports, hosts, accounts, links) read better in mono. */
export function isMonospaceColumn(column: Pick<Column, 'key' | 'label' | 'type'>): boolean {
  if (column.type === 'number' || column.type === 'url') return true
  return MONO_HINTS.test(`${column.key} ${column.label}`)
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatDate(value: string | null | undefined): string {
  const date = parseDate(value)
  if (!date) return value || '—'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatTime(value: string | null | undefined): string {
  const date = parseDate(value)
  if (!date) return '—'
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatDateTime(value: string | null | undefined): string {
  const date = parseDate(value)
  if (!date) return value || '—'
  return `${formatDate(value)} ${formatTime(value)}`
}

export function relativeTime(value: string | null | undefined): string {
  const date = parseDate(value)
  if (!date) return '—'
  const diff = Date.now() - date.getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < 45_000) return translate('刚刚')
  if (diff < hour) return translate('{n} 分钟前', { n: Math.max(1, Math.round(diff / minute)) })
  if (diff < day) return translate('{n} 小时前', { n: Math.round(diff / hour) })
  if (diff < 2 * day) return translate('昨天')
  if (diff < 30 * day) return translate('{n} 天前', { n: Math.round(diff / day) })
  return formatDate(value)
}

export function dayLabel(value: string | null | undefined): string {
  const date = parseDate(value)
  if (!date) return translate('更早')
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diff = Math.round((today.getTime() - target.getTime()) / 86_400_000)
  if (diff === 0) return translate('今天')
  if (diff === 1) return translate('昨天')
  if (diff < 7) return translate('{n} 天前', { n: diff })
  return formatMonthYear(date)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return translate('不锁定')
  const value = Math.max(0, Math.round(seconds))
  const m = Math.floor(value / 60)
  const s = value % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}:${pad(m % 60)}:${pad(s)}`
  }
  return `${pad(m)}:${pad(s)}`
}

export function formatRecoveryCode(code: string): string {
  const clean = (code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return clean.match(/.{1,4}/g)?.join('-') ?? clean
}

export function shortPath(path: string, max = 46): string {
  if (!path || path.length <= max) return path
  const parts = path.split(/[\\/]/)
  if (parts.length < 3) return `…${path.slice(-max + 1)}`
  const file = parts.pop() || ''
  const head = parts.slice(0, 2).join('\\')
  const result = `${head}\\…\\${file}`
  return result.length > max ? `…${path.slice(-max + 1)}` : result
}

export function passwordStrength(value: string): {
  score: number
  label: string
  tone: string
} {
  if (!value) return { score: 0, label: translate('未填写'), tone: 'bg-ice-600' }
  let points = 0
  if (value.length >= 8) points += 1
  if (value.length >= 12) points += 1
  if (value.length >= 18) points += 1
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) points += 1
  if (/\d/.test(value)) points += 1
  if (/[^A-Za-z0-9]/.test(value)) points += 1
  const score = Math.min(4, Math.floor(points * 0.75))
  const table = [
    { label: translate('太弱'), tone: 'bg-rose-500' },
    { label: translate('较弱'), tone: 'bg-orange-400' },
    { label: translate('一般'), tone: 'bg-amber-300' },
    { label: translate('较强'), tone: 'bg-teal-400' },
    { label: translate('很强'), tone: 'bg-emerald-400' },
  ]
  return { score, ...table[score] }
}

export function throttle<T extends (...args: never[]) => void>(fn: T, wait: number): T {
  let last = 0
  let timer: number | undefined
  return ((...args: never[]) => {
    const now = Date.now()
    const remaining = wait - (now - last)
    if (remaining <= 0) {
      last = now
      fn(...args)
    } else if (!timer) {
      timer = window.setTimeout(() => {
        last = Date.now()
        timer = undefined
        fn(...args)
      }, remaining)
    }
  }) as T
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function countLabel(count: number, unit: string): string {
  return `${count} ${unit}`
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  )
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function splitHighlight(text: string, query: string): Array<{ text: string; hit: boolean }> {
  if (!query.trim()) return [{ text, hit: false }]
  const pattern = new RegExp(`(${escapeRegExp(query.trim())})`, 'gi')
  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, hit: part.toLowerCase() === query.trim().toLowerCase() }))
}
