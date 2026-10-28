import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsUpDown,
  Copy,
  Link2,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Column, RecordItem } from '../lib/types'
import { copyText } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { toast } from '../lib/toast'
import { cn, isMonospaceColumn } from '../lib/utils'
import { IconButton, Tip } from './primitives'
import { SecretCell } from './SecretCell'

const CHECK_WIDTH = 38

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) {
    return <ChevronsUpDown className="size-3 text-ice-600 opacity-0 transition group-hover/th:opacity-100" />
  }
  return dir === 'asc' ? (
    <ArrowUp className="size-3 text-[var(--msv-accent-text)]" />
  ) : (
    <ArrowDown className="size-3 text-[var(--msv-accent-text)]" />
  )
}

/** Checkbox that can also render the indeterminate dash for partial selection. */
function RowCheckbox({
  checked,
  indeterminate,
  label,
  onChange,
  className,
}: {
  checked: boolean
  indeterminate?: boolean
  label: string
  onChange: (checked: boolean) => void
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate) && !checked
  }, [indeterminate, checked])

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className={cn('msv-check', className)}
    />
  )
}

/**
 * Copy control for a plain (non-secret) cell. The slot keeps its width at all
 * times and only fades in on row hover, so hovering never reflows the row.
 */
function CopyAction({ value, label }: { value: string; label: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  async function copy() {
    try {
      await copyText(value)
      toast.success(t('已复制{label}', { label }))
      setCopied(true)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error(t('复制失败'), t('无法写入剪贴板'))
    }
  }

  return (
    <Tip
      text={copied ? t('已复制') : t('复制')}
      className={cn(
        'shrink-0 opacity-0 transition-opacity',
        'pointer-events-none group-hover/row:pointer-events-auto group-hover/row:opacity-100',
        'focus-within:pointer-events-auto focus-within:opacity-100',
        copied && 'pointer-events-auto opacity-100',
      )}
    >
      <button
        type="button"
        aria-label={t('复制{label}', { label })}
        onClick={copy}
        className="grid size-5 place-items-center rounded text-ice-600 transition hover:bg-[var(--msv-tint-strong)] hover:text-ice-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--msv-accent)]"
      >
        {copied ? (
          <Check className="size-3 text-[var(--msv-accent-text)]" />
        ) : (
          <Copy className="size-3" />
        )}
      </button>
    </Tip>
  )
}

export function RecordTable({
  columns,
  rows,
  loading,
  compact,
  sortKey,
  sortDir,
  selected,
  onSort,
  onEdit,
  onDelete,
  onConnect,
  onToggleRow,
  onToggleAll,
  onRowMenu,
}: {
  columns: Column[]
  rows: RecordItem[]
  loading: boolean
  compact: boolean
  sortKey: string | null
  sortDir: 'asc' | 'desc'
  selected: Set<number>
  onSort: (key: string) => void
  onEdit: (row: RecordItem) => void
  onDelete: (row: RecordItem) => void
  onConnect: (row: RecordItem) => void
  onToggleRow: (row: RecordItem) => void
  onToggleAll: (checked: boolean) => void
  onRowMenu: (row: RecordItem, position: { x: number; y: number }) => void
}) {
  const { t } = useI18n()

  // Frozen columns are pinned after the selection column, so their offsets all
  // shift right by the checkbox width.
  const frozenLeft = new Map<string, number>()
  let frozenWidth = CHECK_WIDTH
  let lastFrozenKey: string | null = null
  for (const column of columns) {
    if (!column.frozen) continue
    frozenLeft.set(column.key, frozenWidth)
    frozenWidth += Math.max(80, column.width)
    lastFrozenKey = column.key
  }
  const hasFrozen = frozenLeft.size > 0
  const allChecked = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const someChecked = rows.some((row) => selected.has(row.id))

  return (
    <div className="relative min-h-0 flex-1 overflow-auto">
      <table
        className={cn('msv-table', compact && 'compact')}
        style={hasFrozen ? { tableLayout: 'fixed' } : undefined}
      >
        <thead>
          <tr>
            <th
              className="col-check sticky left-0 z-[5] w-[38px] min-w-[38px] border-r border-line bg-[var(--msv-table-head)]"
              style={{ width: CHECK_WIDTH }}
            >
              <RowCheckbox
                label={t('全选本页')}
                checked={allChecked}
                indeterminate={someChecked}
                onChange={onToggleAll}
              />
            </th>
            {columns.map((column) => {
              const active = sortKey === column.key
              return (
                <th
                  key={column.key}
                  data-frozen={frozenLeft.has(column.key) || undefined}
                  style={{
                    width: column.width,
                    minWidth: Math.min(column.width, 220),
                    left: frozenLeft.get(column.key),
                  }}
                  aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={cn(
                    frozenLeft.has(column.key) && 'z-[4] bg-[var(--msv-table-head)]',
                    column.key === lastFrozenKey &&
                      'shadow-[6px_0_14px_-12px_rgba(0,0,0,.55)]',
                  )}
                >
                  <button
                    type="button"
                    disabled={column.masked}
                    onClick={() => onSort(column.key)}
                    className={cn(
                      'group/th inline-flex items-center gap-1.5 transition-colors',
                      column.masked ? 'cursor-default' : 'hover:text-ice-300',
                      active && 'text-ice-300',
                    )}
                  >
                    <span className="truncate">{column.label}</span>
                    {!column.masked && <SortIcon active={active} dir={sortDir} />}
                    {column.secret && (
                      <span
                        className="size-1 rounded-full bg-amber-400/80"
                        title={t('密码字段提示')}
                      />
                    )}
                    {column.encrypted && !column.secret && (
                      <span
                        className="size-1 rounded-full bg-[var(--msv-accent)]"
                        title={t('加密字段提示')}
                      />
                    )}
                  </button>
                </th>
              )
            })}
            <th className="sticky right-0 w-[104px] min-w-[104px] border-l border-line bg-[var(--msv-table-head)] text-right">
              {t('操作')}
            </th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 7 }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`}>
                  <td className="col-check sticky left-0 z-[2] bg-[var(--msv-table-sticky)]" />
                  {columns.map((column, colIndex) => (
                    <td key={column.key}>
                      <span
                        className="skeleton block h-3"
                        style={{ width: `${42 + ((rowIndex * 17 + colIndex * 23) % 48)}%` }}
                      />
                    </td>
                  ))}
                  <td />
                </tr>
              ))
            : rows.map((row) => {
                const checked = selected.has(row.id)
                return (
                  <tr
                    key={row.id}
                    className="group/row"
                    data-active={checked || undefined}
                    onDoubleClick={() => onEdit(row)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      onRowMenu(row, { x: event.clientX, y: event.clientY })
                    }}
                  >
                    <td
                      className="col-check sticky left-0 z-[2] border-r border-line bg-[var(--msv-table-sticky)] group-hover/row:bg-[var(--msv-table-sticky-hover)]"
                      style={{ width: CHECK_WIDTH }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <RowCheckbox
                        label={t('选择记录')}
                        checked={checked}
                        onChange={() => onToggleRow(row)}
                      />
                    </td>
                    {columns.map((column) => {
                      const cell = row.cells[column.key]
                      const frozen = frozenLeft.has(column.key)
                      return (
                        <td
                          key={column.key}
                          data-frozen={frozen || undefined}
                          style={frozen ? { left: frozenLeft.get(column.key) } : undefined}
                          className={cn(
                            column.type === 'textarea' && 'max-w-[280px]',
                            column.masked && 'w-[180px]',
                            frozen &&
                              'sticky z-[2] bg-[var(--msv-table-sticky)] group-hover/row:bg-[var(--msv-table-sticky-hover)]',
                            column.key === lastFrozenKey &&
                              'shadow-[6px_0_14px_-12px_rgba(0,0,0,.55)]',
                          )}
                        >
                          {column.masked ? (
                            <SecretCell
                              recordId={row.id}
                              fieldKey={column.key}
                              label={column.label}
                              cell={cell}
                            />
                          ) : (
                            <div className="flex min-w-0 items-center gap-1">
                              <span
                                className={cn(
                                  'min-w-0 flex-1 truncate',
                                  isMonospaceColumn(column) && 'font-mono text-[0.75rem] tabular-nums',
                                  column.type === 'url' && 'text-[var(--msv-accent-text)]',
                                )}
                                title={cell?.has ? cell.value : undefined}
                              >
                                {cell?.has ? cell.value : <span className="text-ice-600">—</span>}
                              </span>
                              {cell?.has ? (
                                <CopyAction value={cell.value} label={column.label} />
                              ) : (
                                <span className="size-5 shrink-0" aria-hidden="true" />
                              )}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td className="sticky right-0 border-l border-line bg-[var(--msv-table-sticky)] group-hover/row:bg-[var(--msv-table-sticky-hover)]">
                      <div className="row-actions flex items-center justify-end gap-0.5">
                        <IconButton
                          label={t('连接')}
                          tip={t('打开连接（RDP / SecureCRT / 浏览器）')}
                          tipRight
                          onPress={() => onConnect(row)}
                          className="size-7 min-w-7"
                        >
                          <Link2 className="size-3.5" />
                        </IconButton>
                        <IconButton
                          label={t('编辑')}
                          tip={t('编辑记录')}
                          tipRight
                          onPress={() => onEdit(row)}
                          className="size-7 min-w-7"
                        >
                          <Pencil className="size-3.5" />
                        </IconButton>
                        <IconButton
                          label={t('删除')}
                          tip={t('移入回收站')}
                          tipRight
                          onPress={() => onDelete(row)}
                          className="size-7 min-w-7 hover:!text-rose-300"
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                )
              })}
        </tbody>
      </table>
    </div>
  )
}
