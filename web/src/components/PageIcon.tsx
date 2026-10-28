import {
  AppWindow,
  Cctv,
  Cloud,
  Database,
  Folder,
  Globe,
  Grid2X2,
  HardDrive,
  KeyRound,
  LockKeyhole,
  Monitor,
  Network,
  Printer,
  Server,
  ShieldCheck,
  Stethoscope,
  Terminal,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../lib/utils'

export const PAGE_ICONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'server', label: '服务器', icon: Server },
  { id: 'network', label: '网络', icon: Network },
  { id: 'database', label: '数据库', icon: Database },
  { id: 'app', label: '应用', icon: AppWindow },
  { id: 'cloud', label: '云', icon: Cloud },
  { id: 'shield', label: '安全', icon: ShieldCheck },
  { id: 'key', label: '密钥', icon: KeyRound },
  { id: 'grid', label: '通用', icon: Grid2X2 },
  { id: 'terminal', label: '终端', icon: Terminal },
  { id: 'globe', label: '网站', icon: Globe },
  { id: 'lock', label: '保险库', icon: LockKeyhole },
  { id: 'folder', label: '目录', icon: Folder },
  { id: 'monitor', label: '工作站', icon: Monitor },
  { id: 'printer', label: '打印机', icon: Printer },
  { id: 'cctv', label: '监控', icon: Cctv },
  { id: 'storage', label: '存储', icon: HardDrive },
  { id: 'users', label: '账号', icon: Users },
  { id: 'medical', label: '医疗业务', icon: Stethoscope },
]

export function iconFor(name: string | undefined): LucideIcon {
  return PAGE_ICONS.find((item) => item.id === name)?.icon ?? Grid2X2
}

export function PageIcon({
  name,
  className,
  strokeWidth = 1.8,
}: {
  name?: string
  className?: string
  strokeWidth?: number
}) {
  const Icon = iconFor(name)
  return <Icon className={cn('size-4', className)} strokeWidth={strokeWidth} />
}
