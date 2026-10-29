import {
  ChevronDown,
  FolderOpen,
  FolderSync,
  Link2,
  MonitorPlay,
  RadioTower,
  SquareTerminal,
  Zap,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import type { ConnectMode } from '../lib/types'
import { cn } from '../lib/utils'
import { Dropdown, MenuItem, MenuLabel, Tip } from './primitives'

/**
 * One connect button that lets the user override the stored default: the list
 * matches CONNECT_MODES in backend/store.py.
 */
export function ConnectMenu({
  onConnect,
  compact = false,
  disabled = false,
  align = 'right',
}: {
  onConnect: (mode: ConnectMode | '') => void
  compact?: boolean
  disabled?: boolean
  align?: 'left' | 'right'
}) {
  const { t } = useI18n()

  const items: { mode: ConnectMode | ''; label: string; icon: ReactNode }[] = [
    { mode: '', label: t('默认方式（自动判断）'), icon: <Zap className="size-3.5" /> },
    { mode: 'ssh', label: t('SSH 终端'), icon: <SquareTerminal className="size-3.5" /> },
    { mode: 'rdp', label: t('RDP 远程桌面'), icon: <MonitorPlay className="size-3.5" /> },
    { mode: 'telnet', label: t('Telnet 终端'), icon: <RadioTower className="size-3.5" /> },
    { mode: 'ftp', label: t('FTP 文件传输'), icon: <FolderOpen className="size-3.5" /> },
    { mode: 'sftp', label: t('SFTP 文件传输'), icon: <FolderSync className="size-3.5" /> },
    { mode: 'vnc', label: t('VNC 远程桌面'), icon: <MonitorPlay className="size-3.5" /> },
  ]

  return (
    <Dropdown
      align={align}
      width="w-64"
      trigger={
        <Tip text={t('选择连接方式')} right={align === 'left'}>
          <button
            type="button"
            aria-label={t('选择连接方式')}
            disabled={disabled}
            className={cn(
              'inline-flex items-center justify-center gap-0.5 rounded-lg text-ice-500 transition',
              'hover:bg-[var(--msv-tint-strong)] hover:text-ice-200 disabled:opacity-40',
              compact ? 'size-7 min-w-7' : 'h-8 px-2.5 text-[0.71875rem]',
            )}
          >
            <Link2 className={compact ? 'size-3.5' : 'size-4'} />
            {!compact && <span className="whitespace-nowrap">{t('连接')}</span>}
            {!compact && <ChevronDown className="size-3" />}
          </button>
        </Tip>
      }
    >
      <MenuLabel>{t('选择连接方式')}</MenuLabel>
      {items.map((item) => (
        <MenuItem
          key={item.mode || 'default'}
          icon={item.icon}
          label={item.label}
          onSelect={() => onConnect(item.mode)}
        />
      ))}
    </Dropdown>
  )
}
