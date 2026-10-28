import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../lib/i18n'
import { cn } from '../lib/utils'
import { overlayTarget } from './primitives'

/**
 * Text input that offers values already used in this column. The list lives in
 * a portal so it never gets clipped by the scrolling dialog body, and it flips
 * above the field when there is no room below.
 */
export function SuggestInput({
  id,
  value,
  onChange,
  suggestions,
  className,
  placeholder,
  autoComplete = 'off',
  type = 'text',
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  suggestions: string[]
  className?: string
  placeholder?: string
  autoComplete?: string
  type?: string
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const needle = value.trim().toLowerCase()
  const items = suggestions.filter(
    (item) => !needle || (item.toLowerCase() !== needle && item.toLowerCase().includes(needle)),
  )

  useLayoutEffect(() => {
    if (!open) {
      setRect(null)
      setPlacement('bottom')
      setContainer(null)
      return
    }
    const next = inputRef.current?.getBoundingClientRect()
    if (next) setRect(next)
    setContainer(overlayTarget(inputRef.current))
  }, [open])

  useLayoutEffect(() => {
    if (!open || !rect) return
    const list = listRef.current
    if (!list) return
    const spaceBelow = window.innerHeight - rect.bottom - 10
    const spaceAbove = rect.top - 10
    const next = spaceBelow >= list.offsetHeight || spaceBelow >= spaceAbove ? 'bottom' : 'top'
    setPlacement((current) => (current === next ? current : next))
  })

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (inputRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function pick(item: string) {
    onChange(item)
    setOpen(false)
    setActive(-1)
    inputRef.current?.focus()
  }

  const style = rect
    ? {
        left: rect.left,
        width: rect.width,
        ...(placement === 'bottom'
          ? { top: rect.bottom + 4 }
          : { bottom: window.innerHeight - rect.top + 4 }),
      }
    : { left: -9999, top: -9999 }

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        className={cn('msv-input', className)}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (!open || !items.length) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((index) => (index + 1) % items.length)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((index) => (index <= 0 ? items.length - 1 : index - 1))
          } else if (event.key === 'Enter' && active >= 0) {
            event.preventDefault()
            event.stopPropagation()
            pick(items[active])
          } else if (event.key === 'Escape') {
            event.stopPropagation()
            setOpen(false)
          }
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {open &&
        items.length > 0 &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            aria-label={t('历史输入')}
            style={{ ...style, position: 'fixed' }}
            className="pointer-events-auto z-[100012] max-h-[190px] overflow-y-auto rounded-xl border border-line bg-[var(--msv-surface)] p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,.55)] animate-scale-in"
          >
            {items.map((item, index) => (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={index === active}
                // Pointer down (not click) so the choice lands before blur fires.
                onPointerDown={(event) => {
                  event.preventDefault()
                  pick(item)
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[0.75rem] transition',
                  index === active
                    ? 'bg-[var(--msv-accent-soft)] text-[var(--msv-accent-text)]'
                    : 'text-ice-300 hover:bg-[var(--msv-tint-strong)]',
                )}
              >
                <span className="flex-1 truncate">{item}</span>
              </button>
            ))}
          </div>,
          container ?? document.body,
        )}
    </>
  )
}
