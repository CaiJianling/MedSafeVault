/** 与桌面端同名同形的最小控件集：HeroUI 的 Button 配上应用自己的
 *  .msv-input / .chip / .switch / .panel 类，保证后台和客户端看着是一套东西。 */
import { Button } from '@heroui/react'
import { cn } from '../lib/utils'
import type { ReactNode } from 'react'

export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border border-line bg-[var(--msv-tint)] p-4', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[0.8125rem] font-medium text-ice-200">{title}</h3>
          {description && (
            <p className="mt-0.5 text-[0.71875rem] leading-relaxed text-ice-600">{description}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  )
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  children: ReactNode
  htmlFor?: string
  className?: string
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

export function Chip({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode
  tone?: 'default' | 'mint' | 'danger' | 'amber'
  className?: string
}) {
  return (
    <span
      className={cn(
        'chip',
        tone === 'mint' && 'chip-mint',
        tone === 'danger' && 'chip-danger',
        tone === 'amber' && 'chip-amber',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 select-none">
      <span className="switch" data-on={checked ? 'true' : 'false'}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      </span>
      <span className="text-[0.78125rem] text-ice-300">{label}</span>
    </label>
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

export function Primary({
  children,
  onPress,
  disabled,
  busy,
  size = 'md',
  className,
  full,
}: {
  children: ReactNode
  onPress: () => void
  disabled?: boolean
  busy?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
  full?: boolean
}) {
  return (
    <Button
      variant="primary"
      size={size}
      onPress={onPress}
      isDisabled={disabled || busy}
      className={cn(full && 'w-full', className)}
    >
      {busy ? <Spinner className="mr-1.5" /> : null}
      {children}
    </Button>
  )
}

export function Ghost({
  children,
  onPress,
  disabled,
  className,
  size = 'sm',
}: {
  children: ReactNode
  onPress: () => void
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <Button variant="secondary" size={size} onPress={onPress} isDisabled={disabled} className={className}>
      {children}
    </Button>
  )
}

export function RowAction({
  icon,
  label,
  onPress,
  disabled,
  danger,
  withLabel,
}: {
  icon: ReactNode
  label: string
  onPress: () => void
  disabled?: boolean
  danger?: boolean
  withLabel?: boolean
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onPress={onPress}
      isDisabled={disabled}
      className={cn(
        'h-8 rounded-lg px-2 text-ice-500',
        'data-[hovered=true]:bg-[var(--msv-tint-strong)] data-[hovered=true]:text-ice-200',
        'data-[pressed=true]:scale-95',
        danger && 'text-rose-300 data-[hovered=true]:text-rose-200',
      )}
      aria-label={label}
    >
      {icon}
      {withLabel ? <span className="ml-1 text-[0.75rem]">{label}</span> : null}
    </Button>
  )
}
