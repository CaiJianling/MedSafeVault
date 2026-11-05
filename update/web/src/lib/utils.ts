export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(size: number): string {
  if (!size || size < 0) return '0 B'
  let value = size
  let index = 0
  while (value >= 1024 && index < UNITS.length - 1) {
    value /= 1024
    index += 1
  }
  const digits = index === 0 ? 0 : value >= 100 ? 1 : 2
  return `${value.toFixed(digits)} ${UNITS[index]}`
}

/** 版本号：点分数字，最多四段，和服务端 parse_version 一样的宽容度。 */
export const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/

export function versionProblem(value: string): string {
  const text = value.trim()
  if (!text) return '请填写版本号'
  if (!VERSION_PATTERN.test(text)) return '版本号只能是点分数字，例如 2.1.0'
  return ''
}

export function shortHash(value: string, head = 10): string {
  if (!value) return '—'
  return `${value.slice(0, head)}…${value.slice(-6)}`
}

export function nowTime(): string {
  const date = new Date()
  const pad = (item: number) => String(item).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
