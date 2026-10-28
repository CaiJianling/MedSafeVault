import { ShieldCheck } from 'lucide-react'
import { useI18n } from '../lib/i18n'
import { cn } from '../lib/utils'

export function BrandMark({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const dimensions = {
    sm: 'size-8 rounded-[10px]',
    md: 'size-9 rounded-[11px]',
    lg: 'size-12 rounded-[14px]',
  }[size]
  const icon = { sm: 'size-4', md: 'size-[18px]', lg: 'size-6' }[size]
  return (
    <div
      className={cn(
        'brand-mark relative grid shrink-0 place-items-center overflow-hidden',
        dimensions,
        className,
      )}
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(255,255,255,.4),transparent_45%)]" />
      <ShieldCheck className={cn('relative', icon)} strokeWidth={2.2} />
    </div>
  )
}

export function Wordmark({
  compact = false,
  className,
}: {
  compact?: boolean
  className?: string
}) {
  const { t } = useI18n()
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[0.9375rem] font-semibold tracking-[0.01em] text-ice-200">
          MedSafe<span className="text-mint-300">Vault</span>
        </span>
        {!compact && (
          <span className="hidden text-[0.6875rem] font-medium tracking-[0.18em] text-ice-600 sm:inline">
            {t('医安密管平台')}
          </span>
        )}
      </div>
    </div>
  )
}
