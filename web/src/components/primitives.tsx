import { Button, Drawer, Modal } from '@heroui/react'
import { Check, ChevronDown } from 'lucide-react'
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn, passwordStrength } from '../lib/utils'

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'ghost'
  | 'outline'
  | 'danger'
  | 'danger-soft'

export function IconButton({
  label,
  children,
  onPress,
  className,
  variant = 'ghost',
  size = 'sm',
  disabled,
  tip,
  tipRight,
  tipDown,
}: {
  label: string
  children: ReactNode
  onPress?: () => void
  className?: string
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  tip?: string
  tipRight?: boolean
  tipDown?: boolean
}) {
  const button = (
    <Button
      isIconOnly
      aria-label={label}
      variant={variant}
      size={size}
      isDisabled={disabled}
      onPress={onPress}
      className={cn(
        'size-8 min-w-8 rounded-lg text-ice-500 transition-colors',
        'data-[hovered=true]:bg-[var(--msv-tint-strong)] data-[hovered=true]:text-ice-200',
        'data-[pressed=true]:scale-95',
        className,
      )}
    >
      {children}
    </Button>
  )
  if (!tip) return button
  return (
    <span
      className={cn('tip inline-flex', tipRight && 'tip-right', tipDown && 'tip-down')}
      data-tip={tip}
    >
      {button}
    </span>
  )
}

export function Tip({
  text,
  children,
  right = false,
  down = false,
  className,
}: {
  text: string
  children: ReactNode
  right?: boolean
  down?: boolean
  className?: string
}) {
  return (
    <span
      className={cn('tip inline-flex', right && 'tip-right', down && 'tip-down', className)}
      data-tip={text}
    >
      {children}
    </span>
  )
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  children: ReactNode
  className?: string
  htmlFor?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required && <span className="field-required">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[0.71875rem] leading-relaxed text-rose-300">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[0.71875rem] leading-relaxed text-ice-600">{hint}</p>
      ) : null}
    </div>
  )
}

export function ModalFrame({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  footer,
  size = 'md',
  width,
  className,
  bodyClassName,
  dismissable = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'full'
  width?: string
  className?: string
  bodyClassName?: string
  dismissable?: boolean
}) {
  return (
    <Modal.Root isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop variant="blur" isDismissable={dismissable}>
        <Modal.Container size={size} placement="center">
          <Modal.Dialog
            className={cn('border border-line bg-ink-850', className)}
            style={width ? { width: '100%', maxWidth: width } : undefined}
          >
            <Modal.Header className="flex items-start gap-3 pr-10">
              {icon && (
                <Modal.Icon className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-teal-400/20 bg-teal-400/[0.08] text-teal-300">
                  {icon}
                </Modal.Icon>
              )}
              <div className="min-w-0 pt-0.5">
                <Modal.Heading className="truncate font-display text-[1rem] font-semibold text-ice-200">
                  {title}
                </Modal.Heading>
                {description && (
                  <p className="mt-0.5 text-[0.75rem] leading-relaxed text-ice-500">{description}</p>
                )}
              </div>
              {dismissable && (
                <Modal.CloseTrigger className="absolute right-4 top-4 text-ice-500 hover:text-ice-200" />
              )}
            </Modal.Header>
            <Modal.Body className={cn('min-h-0 overflow-x-hidden pt-4', bodyClassName)}>
              {children}
            </Modal.Body>
            {footer && <Modal.Footer className="mt-5">{footer}</Modal.Footer>}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  )
}

export function DrawerFrame({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  footer,
  width = '560px',
  headerExtra,
  bodyHeader,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: string
  headerExtra?: ReactNode
  /** Fixed strip between the header and the scrolling body (section nav). */
  bodyHeader?: ReactNode
}) {
  // HeroUI only paints the off-screen state when React keeps the node mounted,
  // so the panel is parked at translate:100% for one frame and released right
  // after it appears. Without this the drawer jumps in while it still slides
  // out on close.
  const [released, setReleased] = useState(false)

  useEffect(() => {
    if (!open) {
      setReleased(false)
      return
    }
    // requestAnimationFrame pauses in hidden windows, so a timer backs it up:
    // whichever fires first starts the slide-in.
    const fallback = window.setTimeout(() => setReleased(true), 60)
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setReleased(true))
    })
    return () => {
      window.clearTimeout(fallback)
      cancelAnimationFrame(outer)
      if (inner) cancelAnimationFrame(inner)
    }
  }, [open])

  return (
    <Drawer.Root isOpen={open} onOpenChange={onOpenChange}>
      <Drawer.Backdrop variant="blur">
        <Drawer.Content placement="right">
          <Drawer.Dialog
            className="flex h-full max-w-[94vw] flex-col border-l border-line bg-ink-900 p-0"
            style={{ width, translate: released ? undefined : '100% 0' }}
          >
            <Drawer.Header className="shrink-0 border-b border-line px-5 py-4">
              <div className="flex items-start gap-3 pr-9">
                {icon && (
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-teal-400/20 bg-teal-400/[0.08] text-teal-300">
                    {icon}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <Drawer.Heading className="font-display text-[1rem] font-semibold text-ice-200">
                    {title}
                  </Drawer.Heading>
                  {description && (
                    <p className="mt-0.5 text-[0.75rem] text-ice-500">{description}</p>
                  )}
                </div>
                {headerExtra}
              </div>
              <Drawer.CloseTrigger className="absolute right-4 top-4 text-ice-500 hover:text-ice-200" />
            </Drawer.Header>
                        {bodyHeader && (
              <div className="shrink-0 border-b border-line bg-ink-900 px-5 py-2.5">
                {bodyHeader}
              </div>
            )}
            <Drawer.Body className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</Drawer.Body>
            {footer && (
              <Drawer.Footer className="shrink-0 border-t border-line px-5 py-3.5">
                {footer}
              </Drawer.Footer>
            )}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer.Root>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-[1.6px] border-current border-r-transparent',
        className,
      )}
    />
  )
}

/**
 * Renders mixed copy so every numeric run uses the same tabular monospace
 * font, even when the surrounding sentence comes from the i18n dictionary.
 */
export function NumText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\d[\d,.:/·–-]*\d|\d)/g)
  return (
    <span className={className}>
      {parts.map((part, index) =>
        /^\d/.test(part) ? (
          <span key={index} className="font-mono tabular-nums">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-16 text-center',
        className,
      )}
    >
      <div className="relative mb-4">
        <div className="absolute inset-0 rounded-2xl bg-teal-400/10 blur-xl" />
        <div className="relative grid size-14 place-items-center rounded-2xl border border-line bg-[var(--msv-tint)] text-ice-500">
          {icon}
        </div>
      </div>
      <div className="text-[0.875rem] font-medium text-ice-300">{title}</div>
      {description && (
        <p className="mt-1.5 max-w-[360px] text-[0.75rem] leading-relaxed text-ice-600">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T
  onChange: (value: T) => void
  items: { value: T; label: string; count?: number }[]
  className?: string
}) {
  return (
    <div className={cn('segmented', className)} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          data-active={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {item.count != null && (
            <span className="ml-1 text-[0.6875rem] opacity-90">{item.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={cn('switch', disabled && 'cursor-not-allowed opacity-50')} data-on={checked}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  )
}

export function StrengthMeter({
  value,
  compact = false,
}: {
  value: string
  compact?: boolean
}) {
  const strength = passwordStrength(value)
  return (
    <div className={cn('flex items-center gap-2.5', compact ? 'mt-2' : 'mt-3')}>
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              index < strength.score ? strength.tone : 'bg-[var(--msv-tint-strong)]',
            )}
          />
        ))}
      </div>
      <span className="shrink-0 text-right text-[0.6875rem] whitespace-nowrap text-ice-600">
        {strength.label}
      </span>
    </div>
  )
}

const DropdownClose = createContext<() => void>(() => {})

/**
 * While a modal or drawer is open React Aria marks the rest of <body> inert, so
 * a menu portaled to the document root paints correctly but cannot be clicked.
 * Attaching to the overlay's own container keeps it interactive, and that
 * container already fills the viewport, so fixed coordinates still line up.
 */
export function overlayTarget(node: Element | null): HTMLElement {
  return (
    node?.closest<HTMLElement>(
      '[data-slot="modal-container"], [data-slot="drawer-content"], [data-slot="popover-container"]',
    ) ?? document.body
  )
}

export function Dropdown({
  trigger,
  children,
  align = 'right',
  width = 'w-56',
  matchWidth = false,
  fullWidth = false,
  menuClassName,
}: {
  trigger: ReactNode
  children: ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string
  matchWidth?: boolean
  fullWidth?: boolean
  menuClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')
  const [menuWidth, setMenuWidth] = useState(0)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) {
      setRect(null)
      setPlacement('bottom')
      setContainer(null)
      return
    }
    const measure = () => {
      const next = wrapperRef.current?.getBoundingClientRect()
      if (next) setRect(next)
      setContainer(overlayTarget(wrapperRef.current))
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  // Flip above the trigger when the viewport runs out of room below, and keep
  // the measured width so a centred menu can be balanced against the trigger.
  useLayoutEffect(() => {
    if (!open || !rect) return
    const menu = menuRef.current
    if (!menu) return
    const spaceBelow = window.innerHeight - rect.bottom - 10
    const spaceAbove = rect.top - 10
    const next = spaceBelow >= menu.offsetHeight || spaceBelow >= spaceAbove ? 'bottom' : 'top'
    setPlacement((current) => (current === next ? current : next))
    setMenuWidth((current) => (current === menu.offsetWidth ? current : menu.offsetWidth))
  })

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (wrapperRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const centeredLeft = rect
    ? Math.max(8, Math.min(rect.left + rect.width / 2 - menuWidth / 2, window.innerWidth - menuWidth - 8))
    : 0

  const style: CSSProperties = rect
    ? {
        left:
          align === 'left'
            ? rect.left
            : align === 'center'
              ? menuWidth
                ? centeredLeft
                : rect.left
              : undefined,
        right: align === 'right' ? window.innerWidth - rect.right : undefined,
        ...(matchWidth ? { minWidth: rect.width } : {}),
        ...(placement === 'bottom'
          ? { top: rect.bottom + 6 }
          : { bottom: window.innerHeight - rect.top + 6 }),
      }
    : { left: -9999, top: -9999 }

  return (
    <div
      className={cn('relative', fullWidth ? 'flex w-full min-w-0' : 'inline-flex')}
      ref={wrapperRef}
    >
      <div
        className={cn(fullWidth ? 'flex w-full min-w-0' : 'inline-flex')}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </div>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={style}
            className={cn(
              'pointer-events-auto fixed z-[100010] max-h-[min(340px,70vh)] overflow-y-auto rounded-xl border border-line bg-[var(--msv-surface)] p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,.55)] animate-scale-in',
              matchWidth
                ? 'w-max max-w-[min(420px,calc(100vw-24px))]'
                : width,
              menuClassName,
            )}
          >
            <DropdownClose.Provider value={() => setOpen(false)}>{children}</DropdownClose.Provider>
          </div>,
          container ?? document.body,
        )}
    </div>
  )
}

export function MenuRadioItem({
  icon,
  label,
  hint,
  active,
  onSelect,
  disabled,
}: {
  icon?: ReactNode
  label: string
  hint?: string
  active?: boolean
  onSelect: () => void
  disabled?: boolean
}) {
  const close = useContext(DropdownClose)
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={Boolean(active)}
      disabled={disabled}
      onClick={() => {
        close()
        onSelect()
      }}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[0.78125rem] transition',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-[var(--msv-accent-soft)] text-[var(--msv-accent-text)]'
          : 'text-ice-300 hover:bg-[var(--msv-tint-strong)] hover:text-ice-200',
      )}
    >
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-[0.6875rem] text-ice-600">{hint}</span>}
      <Check className={cn('size-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
    </button>
  )
}

export function SelectMenu<T extends string>({
  value,
  items,
  onChange,
  className,
  ariaLabel,
  placeholder,
  align = 'left',
  centered = false,
}: {
  value: T | ''
  items: { value: T; label: string; hint?: string }[]
  onChange: (value: T) => void
  className?: string
  ariaLabel?: string
  placeholder?: string
  align?: 'left' | 'right' | 'center'
  centered?: boolean
}) {
  const selected = items.find((item) => item.value === value)
  return (
    <Dropdown
      align={align}
      matchWidth
      fullWidth
      width="w-full"
      trigger={
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          className={cn(
            'msv-input flex items-center gap-1.5 text-left text-[0.78125rem]',
            centered ? 'justify-center' : 'justify-between',
            className,
          )}
        >
          <span
            className={cn(
              'truncate',
              !centered && 'flex-1',
              !selected && 'text-ice-600',
            )}
          >
            {selected?.label ?? placeholder ?? ''}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-ice-500" />
        </button>
      }
    >
      {items.map((item) => (
        <MenuRadioItem
          key={item.value}
          label={item.label}
          hint={item.hint}
          active={item.value === value}
          onSelect={() => onChange(item.value)}
        />
      ))}
    </Dropdown>
  )
}

export function MenuItem({
  icon,
  label,
  hint,
  onSelect,
  danger,
  disabled,
}: {
  icon?: ReactNode
  label: string
  hint?: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}) {
  const close = useContext(DropdownClose)
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close()
        onSelect()
      }}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.78125rem] transition',
        'disabled:cursor-not-allowed disabled:opacity-40',
        danger
          ? 'text-rose-300 hover:bg-rose-400/10'
          : 'text-ice-300 hover:bg-[var(--msv-tint-strong)] hover:text-ice-200',
      )}
    >
      {icon && <span className="shrink-0 text-ice-500">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-[0.6875rem] text-ice-600">{hint}</span>}
    </button>
  )
}

export function ContextMenu({
  position,
  onClose,
  children,
  width = 'w-56',
}: {
  position: { x: number; y: number } | null
  onClose: () => void
  children: ReactNode
  width?: string
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ left: -9999, top: -9999 })

  // Keep the menu inside the viewport, flipping it back when the cursor sits
  // close to a corner.
  useLayoutEffect(() => {
    if (!position) return
    const menu = menuRef.current
    const width = menu?.offsetWidth ?? 224
    const height = menu?.offsetHeight ?? 180
    setStyle({
      left: Math.max(8, Math.min(position.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(position.y, window.innerHeight - height - 8)),
    })
  }, [position])

  useEffect(() => {
    if (!position) return
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // Close on page scroll, but not when the menu itself is the thing being
    // scrolled — a long menu has to stay open while you wheel through it.
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [position, onClose])

  if (!position) return null
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={style}
      className={cn(
        'pointer-events-auto fixed z-[100011] max-h-[min(340px,70vh)] overflow-y-auto rounded-xl border border-line bg-[var(--msv-surface)] p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,.55)] animate-scale-in',
        width,
      )}
    >
      <DropdownClose.Provider value={onClose}>{children}</DropdownClose.Provider>
    </div>,
    document.body,
  )
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-1.5 text-[0.6875rem] font-medium tracking-[0.1em] text-ice-600">
      {children}
    </div>
  )
}

export function PlainButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[0.78125rem] text-ice-300 transition hover:border-line-strong hover:bg-[var(--msv-tint)] hover:text-ice-200',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function Section({
  title,
  description,
  children,
  action,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border border-line bg-[var(--msv-tint)] p-4', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[0.8125rem] font-medium text-ice-200">{title}</h3>
          {description && <p className="mt-0.5 text-[0.71875rem] text-ice-600">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-[var(--msv-tint)] px-1.5 py-0.5 font-mono text-[0.6875rem] text-ice-500">
      {children}
    </kbd>
  )
}
