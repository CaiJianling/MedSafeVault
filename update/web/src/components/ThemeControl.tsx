import { useTheme } from '@heroui/react'
import { useEffect } from 'react'
import { THEME_OPTIONS, syncThemeMeta, type ThemeMode } from '../lib/theme'
import { cn } from '../lib/utils'

/**
 * 亮色 / 暗色 / 跟随系统三档，和桌面端 设置 → 常规 → 主题模式 同一套语义：
 * 存的是意图，「跟随系统」时由 HeroUI 的 useTheme 订阅 `prefers-color-scheme`，
 * 系统切换深浅色页面立刻跟着变；另外两档固定不变。
 */
export function ThemeControl({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme('system')

  useEffect(() => {
    syncThemeMeta(resolvedTheme)
  }, [resolvedTheme])

  const mode: ThemeMode = theme === 'light' || theme === 'dark' ? theme : 'system'

  return (
    <div className={cn('segmented shrink-0', className)} role="group" aria-label="主题模式">
      {THEME_OPTIONS.map((option) => {
        const active = mode === option.value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            data-active={active}
            title={option.label}
            onClick={() => setTheme(option.value)}
            className="inline-flex items-center gap-1 px-2"
          >
            <Icon className="size-3.5" />
            <span className="hidden whitespace-nowrap lg:inline">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
