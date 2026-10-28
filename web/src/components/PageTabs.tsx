import { Plus } from 'lucide-react'
import { useI18n } from '../lib/i18n'
import type { Page } from '../lib/types'
import { cn } from '../lib/utils'
import { PageIcon } from './PageIcon'
import { Tip } from './primitives'

export function PageTabs({
  pages,
  activeId,
  onSelect,
  onAdd,
}: {
  pages: Page[]
  activeId: number | null
  onSelect: (pageId: number) => void
  onAdd: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="relative z-20 flex shrink-0 items-center gap-2 border-b border-line bg-[var(--msv-table-head)]/60 px-3 sm:px-4">
      <div
        className="no-scrollbar flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto py-1.5"
        role="tablist"
        aria-label={t('密码库页面')}
      >
        {pages.map((page) => {
          const active = page.id === activeId
          return (
            <button
              key={page.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(page.id)}
              className={cn(
                'group relative flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[0.78125rem] transition-all',
                active
                  ? 'bg-[var(--msv-tint-strong)] text-ice-200 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--msv-accent)_22%,transparent)]'
                  : 'text-ice-500 hover:bg-[var(--msv-tint)] hover:text-ice-300',
              )}
            >
              <PageIcon
                name={page.icon}
                className={cn(
                  'size-[15px] transition-colors',
                  active ? 'text-teal-300' : 'text-ice-600 group-hover:text-ice-400',
                )}
              />
              <span className="max-w-[130px] truncate font-medium">{page.name}</span>
              <span
                className={cn(
                  'rounded px-1.5 py-px font-mono text-[0.6875rem] leading-[15px] tabular-nums transition-colors',
                  active
                    ? 'bg-teal-400/15 text-teal-200'
                    : 'bg-[var(--msv-tint)] text-ice-600 group-hover:text-ice-500',
                )}
              >
                {page.record_count ?? 0}
              </span>
              {page.hidden_columns ? (
                <Tip text={t('{n} 列已隐藏', { n: page.hidden_columns })}>
                  <span className="size-1.5 rounded-full bg-amber-400/70" />
                </Tip>
              ) : null}
              {active && (
                <span className="absolute inset-x-2 -bottom-[7px] h-[2px] rounded-full bg-[linear-gradient(90deg,transparent,var(--msv-accent),transparent)]" />
              )}
            </button>
          )
        })}

        <Tip text={t('新建页面')} down>
          <button
            type="button"
            aria-label={t('新建页面')}
            onClick={onAdd}
            className="ml-1 grid size-8 shrink-0 place-items-center self-center rounded-lg border border-dashed border-line text-ice-600 transition hover:border-teal-400/35 hover:bg-teal-400/[0.05] hover:text-teal-300"
          >
            <Plus className="size-4" />
          </button>
        </Tip>
      </div>

      <div className="hidden shrink-0 items-center gap-2 text-[0.6875rem] text-ice-600 lg:flex">
        <span className="font-mono tracking-wider">
          {String(pages.length).padStart(2, '0')} PAGES
        </span>
      </div>
    </div>
  )
}
