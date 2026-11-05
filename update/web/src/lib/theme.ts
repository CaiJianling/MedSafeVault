/**
 * 主题模式：亮色 / 暗色 / 跟随系统，和桌面端一样存在 localStorage 的
 * `heroui-theme` 键里（存的是「意图」而不是解析结果，所以系统切换深色时
 * 选「跟随系统」的浏览器会跟着变），index.html 的首屏脚本按同一套规则预设，
 * 避免刷新时闪一下。渲染交给 HeroUI 的 `useTheme`，这里只放选项与元信息同步。
 */
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'

export type ThemeMode = 'system' | 'light' | 'dark'

export const THEME_OPTIONS: { value: ThemeMode; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '亮色', icon: Sun },
  { value: 'dark', label: '暗色', icon: Moon },
]

/** 浏览器标签条/移动端地址栏的底色跟着解析后的主题走。
 *  `useTheme` 的 resolvedTheme 是 string（HeroUI 允许自定义主题名），这里只认 dark。 */
export function syncThemeMeta(resolved: string | undefined): void {
  const root = document.documentElement
  root.style.colorScheme = resolved || 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#090d13' : '#eef3f9')
}
