import {
  CircleHelp,
  History,
  Languages,
  LockKeyhole,
  Monitor,
  Moon,
  Redo2,
  Settings2,
  ShieldCheck,
  Sun,
  Timer,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { StateInfo, UndoState } from '../lib/types'
import { useI18n, type Locale } from '../lib/i18n'
import { cn, formatDuration } from '../lib/utils'
import type { ThemeMode } from '../App'
import { BrandMark } from './Brand'
import { IconButton, Tip } from './primitives'

const THEME_ORDER: ThemeMode[] = ['system', 'light', 'dark']

const THEME_ICON: Record<ThemeMode, ReactNode> = {
  system: <Monitor className="size-4" />,
  light: <Sun className="size-4" />,
  dark: <Moon className="size-4" />,
}

function CountdownRing({
  remaining,
  total,
  onClick,
}: {
  remaining: number | null
  total: number
  onClick: () => void
}) {
  const { t } = useI18n()
  if (!total || remaining == null) {
    return (
      <Tip text={t('自动锁定已关闭')} down>
        <button
          type="button"
          onClick={onClick}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2.5 text-[0.71875rem] text-ice-500 transition hover:border-line-strong hover:text-ice-300"
        >
          <Timer className="size-3.5" />
          {t('不自动锁定')}
        </button>
      </Tip>
    )
  }
  const ratio = Math.max(0, Math.min(1, remaining / total))
  const urgent = remaining <= 60
  const circumference = 2 * Math.PI * 7
  return (
    <Tip text={t('无操作 {n} 分钟后自动锁定 · 点击调整', { n: total / 60 })} down>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 font-mono text-[0.71875rem] tabular-nums transition',
          urgent
            ? 'border-amber-400/35 bg-amber-400/[0.1] text-amber-200'
            : 'border-line text-ice-500 hover:border-line-strong hover:text-ice-300',
        )}
      >
        <span className="relative grid size-4 place-items-center">
          <svg viewBox="0 0 18 18" className="absolute inset-0 -rotate-90">
            <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.6" />
            <circle
              cx="9"
              cy="9"
              r="7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - ratio)}
              className="transition-[stroke-dashoffset] duration-1000 ease-linear"
            />
          </svg>
        </span>
        {formatDuration(remaining)}
      </button>
    </Tip>
  )
}

export function Header({
  state,
  remaining,
  undoState,
  theme,
  onTheme,
  locale,
  onLocale,
  onUndo,
  onRedo,
  onHistory,
  onRecycle,
  onSettings,
  onHelp,
  onLock,
}: {
  state: StateInfo
  remaining: number | null
  undoState: UndoState | null
  theme: ThemeMode
  onTheme: (theme: ThemeMode) => void
  locale: Locale
  onLocale: (locale: Locale) => void
  onUndo: () => void
  onRedo: () => void
  onHistory: () => void
  onRecycle: () => void
  onSettings: () => void
  onHelp: () => void
  onLock: () => void
}) {
  const { t } = useI18n()
  const themeLabel =
    theme === 'system' ? t('跟随系统') : theme === 'light' ? t('亮色') : t('暗色')

  function cycleTheme() {
    const index = THEME_ORDER.indexOf(theme)
    onTheme(THEME_ORDER[(index + 1) % THEME_ORDER.length])
  }

  return (
    <header className="glass-bar relative z-30 flex h-[58px] shrink-0 items-center gap-1.5 px-3 sm:gap-3 sm:px-5">
      <div className="flex shrink-0 items-center gap-2.5">
        <BrandMark size="sm" />
        <div className="hidden min-w-0 leading-tight sm:block">
          <div className="truncate font-display text-[0.875rem] font-semibold tracking-tight text-ice-200">
            MedSafe<span className="text-teal-300">Vault</span>
          </div>
          <div className="hidden truncate text-[0.6875rem] tracking-[0.14em] text-ice-600 lg:block">
            {t('医安密管平台')}
          </div>
        </div>
      </div>

      <div className="mx-1 hidden h-6 w-px bg-line xl:block" />

      <div className="hidden shrink-0 items-center gap-2 xl:flex">
        <span className="chip chip-mint">
          <ShieldCheck className="size-3" />
          AES-256-GCM
        </span>
        <span className="chip">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          {t('密钥仅在本机内存')}
        </span>
      </div>

      <div className="min-w-0 flex-1" />

      <div className="flex shrink-0 items-center gap-0.5">
        <Tip down text={undoState?.undo ? t('撤回：{title}', { title: undoState.undo.title }) : t('没有可撤回的操作')}>
          <button
            type="button"
            aria-label={t('撤回')}
            disabled={!undoState?.can_undo}
            onClick={onUndo}
            className="grid size-8 place-items-center rounded-lg text-ice-500 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-200 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Undo2 className="size-4" />
          </button>
        </Tip>
        <Tip down text={undoState?.redo ? t('恢复：{title}', { title: undoState.redo.title }) : t('没有可恢复的操作')}>
          <button
            type="button"
            aria-label={t('重做')}
            disabled={!undoState?.can_redo}
            onClick={onRedo}
            className="grid size-8 place-items-center rounded-lg text-ice-500 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-200 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Redo2 className="size-4" />
          </button>
        </Tip>
      </div>

      <div className="mx-1 hidden h-5 w-px bg-line sm:block" />

      <IconButton label={t('修改历史')} tip={t('修改历史与撤回')} tipDown onPress={onHistory}>
        <History className="size-4" />
      </IconButton>
      <IconButton label={t('回收站')} tip={t('回收站')} tipDown onPress={onRecycle}>
        <Trash2 className="size-4" />
      </IconButton>
      <IconButton label={t('设置')} tip={t('设置')} tipDown onPress={onSettings}>
        <Settings2 className="size-4" />
      </IconButton>
      <IconButton label={t('帮助说明')} tip={t('帮助说明')} tipDown onPress={onHelp}>
        <CircleHelp className="size-4" />
      </IconButton>

      <div className="mx-1 hidden h-5 w-px bg-line sm:block" />

      <Tip text={`${t('主题')} · ${themeLabel}`} down>
        <button
          type="button"
          aria-label={t('切换主题')}
          onClick={cycleTheme}
          className="grid size-8 place-items-center rounded-lg text-ice-500 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-200"
        >
          {THEME_ICON[theme]}
        </button>
      </Tip>
      <Tip text={`${t('语言')} · ${locale === 'zh' ? t('简体中文') : 'English'}`} down>
        <button
          type="button"
          aria-label={t('切换语言')}
          onClick={() => onLocale(locale === 'zh' ? 'en' : 'zh')}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-[0.71875rem] font-medium text-ice-500 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-200"
        >
          <Languages className="size-4" />
          <span className="font-mono">{locale === 'zh' ? 'EN' : '中'}</span>
        </button>
      </Tip>

      <div className="mx-1 hidden h-5 w-px bg-line sm:block" />

      <CountdownRing
        remaining={remaining}
        total={state.auto_lock_minutes * 60}
        onClick={onSettings}
      />

      <button
        type="button"
        onClick={onLock}
        className="ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-teal-400/30 bg-teal-400/[0.09] px-2.5 text-[0.71875rem] font-medium text-teal-200 transition hover:border-teal-400/45 hover:bg-teal-400/[0.15]"
      >
        <LockKeyhole className="size-3.5" />
        {t('锁定')}
      </button>
    </header>
  )
}
