import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Database,
  Download,
  FileArchive,
  FileKey2,
  FolderOpen,
  HardDrive,
  KeyRound,
  Lock,
  Monitor,
  RefreshCw,
  RotateCcw,
  ServerCog,
  Settings2,
  ShieldCheck,
  Terminal,
  Type,
  Upload,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { ThemeMode } from '../App'
import { ApiError, api, copyText } from '../lib/api'
import { useConfirm } from '../lib/confirm'
import { useI18n, type Locale } from '../lib/i18n'
import { toast } from '../lib/toast'
import type {
  AboutInfo,
  Accent,
  BackupInfo,
  DataLocation,
  EnvironmentInfo,
  RecoveryInfo,
  RecoveryStatus,
  Settings,
  StateInfo,
} from '../lib/types'
import {
  cn,
  formatBytes,
  formatDateTime,
  passwordStrength,
  shortPath,
} from '../lib/utils'
import {
  IconButton,
  ModalFrame,
  Section,
  Segmented,
  SelectMenu,
  Spinner,
  StrengthMeter,
  Switch,
  Tip,
} from './primitives'
import { BackupPasswordDialog } from './BackupPasswordDialog'
import { RecoveryCodeDialog } from './RecoveryCodeDialog'
import {
  FALLBACK_CODE_FONTS,
  FALLBACK_UI_FONTS,
  canReadSystemFonts,
  mergeFonts,
  readSystemFonts,
  withDefault,
} from '../lib/fonts'

type Tab = 'general' | 'security' | 'data' | 'about'
type ProgramKey =
  | 'securecrt_path'
  | 'putty_path'
  | 'xshell_path'
  | 'winscp_path'
  | 'vnc_viewer_path'

/** Hue ids mirrored by the [data-accent] blocks in styles.css. */
const ACCENT_OPTIONS: { id: Accent; name: string }[] = [
  { id: 'blue', name: '海蓝' },
  { id: 'sky', name: '天青' },
  { id: 'cyan', name: '湖青' },
  { id: 'teal', name: '松绿' },
  { id: 'emerald', name: '翡翠' },
  { id: 'violet', name: '紫罗兰' },
  { id: 'rose', name: '玫红' },
  { id: 'amber', name: '琥珀' },
]

function Row({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-2.5', className)}>
      <div className="min-w-0">
        <div className="text-[0.78125rem] text-ice-300">{title}</div>
        {description && (
          <div className="mt-0.5 text-[0.71875rem] leading-relaxed text-ice-600">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SettingsDialog({
  open,
  onOpenChange,
  state,
  theme,
  onTheme,
  locale,
  onLocale,
  onSettings,
  onRestored,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: StateInfo
  theme: ThemeMode
  onTheme: (theme: ThemeMode) => void
  locale: Locale
  onLocale: (locale: Locale) => void
  onSettings: (settings: Settings) => void
  onRestored: (state: StateInfo) => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const [tab, setTab] = useState<Tab>('general')
  const [settings, setSettings] = useState<Settings>(state.settings)
  const [savingKey, setSavingKey] = useState('')

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [changing, setChanging] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>(state.recovery)
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryInfo | null>(null)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [rotating, setRotating] = useState(false)

  const [backupInfo, setBackupInfo] = useState<BackupInfo | null>(null)
  const [backupPath, setBackupPath] = useState('')
  const [backupPassword, setBackupPassword] = useState('')
  const [backupSealed, setBackupSealed] = useState(false)
  const [checkingBackup, setCheckingBackup] = useState(false)
  const [backupDialogOpen, setBackupDialogOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [systemFonts, setSystemFonts] = useState<string[]>([])
  const [readingFonts, setReadingFonts] = useState(false)

  const uiFontItems = useMemo(
    () => withDefault(mergeFonts(FALLBACK_UI_FONTS, systemFonts), t('系统默认')),
    [systemFonts, t],
  )
  const codeFontItems = useMemo(
    () => withDefault(mergeFonts(FALLBACK_CODE_FONTS, systemFonts), t('等宽默认')),
    [systemFonts, t],
  )

  async function loadFonts() {
    if (readingFonts) return
    if (!canReadSystemFonts()) {
      toast.info(t('当前环境无法读取系统字体'), t('已提供常用字体列表，可直接选择。'))
      return
    }
    setReadingFonts(true)
    try {
      const families = await readSystemFonts()
      if (families.length) {
        setSystemFonts(families)
        toast.success(t('已读取 {n} 个系统字体', { n: families.length }))
      } else {
        toast.warning(t('未获得字体读取权限'), t('请在权限提示中允许后重试。'))
      }
    } finally {
      setReadingFonts(false)
    }
  }

  const [about, setAbout] = useState<AboutInfo | null>(null)
  const [aboutLoading, setAboutLoading] = useState(false)

  const tabItems: { value: Tab; label: string }[] = [
    { value: 'general', label: t('常规') },
    { value: 'security', label: t('安全') },
    { value: 'data', label: t('数据') },
    { value: 'about', label: t('关于') },
  ]

  useEffect(() => {
    if (open) {
      setSettings(state.settings)
      setRecoveryStatus(state.recovery)
      setPasswordError('')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setBackupInfo(null)
      setBackupPassword('')
      setBackupSealed(false)
    }
  }, [open, state.settings, state.recovery])

  useEffect(() => {
    if (!open || tab !== 'about') return
    setAboutLoading(true)
    api
      .getAbout()
      .then((result) => setAbout(result.about))
      .catch(() => setAbout(null))
      .finally(() => setAboutLoading(false))
  }, [open, tab])

  // Data directory: the backend only rewrites <app dir>/MedSafeVault.json and
  // moves the files while the app shuts down, so every change here is "pending".
  const [location, setLocation] = useState<DataLocation | null>(null)
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null)
  const [customPath, setCustomPath] = useState('')
  const [locationBusy, setLocationBusy] = useState(false)

  useEffect(() => {
    if (!open || tab !== 'data') return
    api
      .getDataLocation()
      .then((result) => {
        setLocation(result.location)
        if (result.location.mode === 'custom') setCustomPath(result.location.path)
      })
      .catch(() => setLocation(null))
    api
      .getEnvironment()
      .then((result) => setEnvironment(result.environment))
      .catch(() => setEnvironment(null))
  }, [open, tab])

  const requestLocation = (mode: string, target?: string) => {
    setLocationBusy(true)
    api
      .setDataLocation(mode, target)
      .then((result) => {
        setLocation((previous) => (previous ? { ...previous, pending: result.pending } : previous))
        if (result.already_there) {
          toast.success(t('数据目录已是该位置'), t('无需移动文件。'))
        } else {
          toast.success(t('已记录，重启后生效'), t('退出程序时会自动搬移数据。'))
        }
      })
      .catch((error) =>
        toast.error(t('目录未更改'), error instanceof ApiError ? error.message : t('请重试')),
      )
      .finally(() => setLocationBusy(false))
  }

  const pickFolder = () => {
    api
      .chooseDataDir()
      .then((result) => {
        if (result.cancelled || !result.path) return
        setCustomPath(result.path)
        requestLocation('custom', result.path)
      })
      .catch((error) =>
        toast.error(t('无法打开文件夹选择'), error instanceof ApiError ? error.message : t('请重试')),
      )
  }

  const cancelLocationRequest = () => {
    api
      .cancelDataLocation()
      .then(() => setLocation((previous) => (previous ? { ...previous, pending: null } : previous)))
      .catch(() => undefined)
  }

  const quitAndApply = () => {
    api
      .quit()
      .then(() => undefined)
      .catch(() => undefined)
  }

  const locationOptions: {
    mode: 'appdata' | 'portable' | 'custom'
    title: string
    hint: string
    path: string
    icon: typeof HardDrive
  }[] = [
    {
      mode: 'appdata',
      title: t('%APPDATA%\\MedSafeVault'),
      hint: t('默认位置，普通用户可写，不需要管理员权限。'),
      path: location?.defaults.appdata ?? '',
      icon: HardDrive,
    },
    {
      mode: 'portable',
      title: t('应用程序所在目录'),
      hint: t('数据跟着 exe 走，适合拷到移动硬盘或共享盘。'),
      path: location?.defaults.portable ?? '',
      icon: FolderOpen,
    },
    {
      mode: 'custom',
      title: t('自定义目录'),
      hint: t('放到加密盘或信息科指定的存储位置。'),
      path:
        customPath || (location?.mode === 'custom' ? location.path : t('尚未选择')),
      icon: Settings2,
    },
  ]

  const envRows: { name: string; value: string | null; description: string }[] = [
    {
      name: 'MEDSAFE_DATA_DIR',
      value: environment?.MEDSAFE_DATA_DIR ?? location?.env_override ?? null,
      description: t('强制指定数据目录，优先级高于本页面的设置。'),
    },
    {
      name: 'MSV_DEV_URL',
      value: environment?.MSV_DEV_URL ?? null,
      description: t('让桌面端加载本地前端开发服务器，仅用于开发调试。'),
    },
    {
      name: 'MSV_DEBUG',
      value: environment?.MSV_DEBUG ?? null,
      description: t('设为 1 时启动附带 WebView2 开发者工具。'),
    },
  ]

  const strength = useMemo(() => passwordStrength(newPassword), [newPassword])

  const programRows: { key: ProgramKey; label: string; exe: string; path: string }[] = [
    {
      key: 'securecrt_path',
      label: 'SecureCRT',
      exe: 'SecureCRT.exe',
      path: settings.securecrt_path,
    },
    { key: 'putty_path', label: 'PuTTY', exe: 'putty.exe', path: settings.putty_path },
    { key: 'xshell_path', label: 'Xshell', exe: 'Xshell.exe', path: settings.xshell_path },
    { key: 'winscp_path', label: 'WinSCP', exe: 'WinSCP.exe', path: settings.winscp_path },
    {
      key: 'vnc_viewer_path',
      label: 'VNC Viewer',
      exe: 'vncviewer.exe',
      path: settings.vnc_viewer_path,
    },
  ]

  async function updateSettings(patch: Partial<Settings>, key: string) {
    const previous = settings
    const next = { ...settings, ...patch }
    setSettings(next)
    setSavingKey(key)
    try {
      const result = await api.setSettings(patch)
      setSettings(result.settings)
      onSettings(result.settings)
    } catch (error) {
      setSettings(previous)
      onSettings(previous)
      toast.error(t('设置未保存'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setSavingKey('')
    }
  }

  async function chooseProgram(key: ProgramKey = 'securecrt_path', label = t('SecureCRT')) {
    setSavingKey(key)
    try {
      const result = await api.chooseProgram(key)
      if (result.cancelled) return
      if (result.settings) {
        setSettings(result.settings)
        onSettings(result.settings)
        toast.success(t('{name} 路径已更新', { name: label }))
      }
    } catch (error) {
      toast.error(t('无法选择程序'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setSavingKey('')
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    if (changing) return
    if (!oldPassword) {
      setPasswordError(t('请输入当前打开密码'))
      return
    }
    if (newPassword.length < 8) {
      setPasswordError(t('新的打开密码至少需要 8 位'))
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('两次输入的新密码不一致'))
      return
    }
    setPasswordError('')
    setChanging(true)
    try {
      await api.changeMasterPassword(oldPassword, newPassword)
      toast.success(
        t('打开密码已修改'),
        t('数据密钥已用新密码重新包裹，请妥善保管新密码'),
      )
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error) {
      setPasswordError(error instanceof ApiError ? error.message : t('修改失败，请重试'))
    } finally {
      setChanging(false)
    }
  }

  async function rotateRecovery() {
    const ok = await confirm({
      title: t('重新生成恢复密钥？'),
      description: t(
        '新的恢复密钥生成后，之前保存的所有恢复密钥文件与恢复码会立即失效。请确认你仍能访问当前密码库，并在生成后立即保存新文件。',
      ),
      confirmText: t('重新生成'),
      requireText: t('生成'),
      icon: <FileKey2 className="size-5" />,
    })
    if (!ok) return
    setRotating(true)
    try {
      const result = await api.rotateRecovery()
      setRecoveryInfo(result.recovery)
      setRecoveryStatus(result.status)
      setRecoveryOpen(true)
    } catch (error) {
      toast.error(t('生成失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setRotating(false)
    }
  }

  async function runExport(password: string) {
    setExporting(true)
    try {
      const result = await api.exportBackup(password)
      if (result.cancelled) return
      toast.success(
        t('加密备份已导出'),
        t('整个文件已用备份密码加密：\n{path}', { path: shortPath(result.path ?? '') }),
        { duration: 8000 },
      )
    } catch (error) {
      toast.error(t('导出失败'), error instanceof ApiError ? error.message : t('请重试'))
      throw error
    } finally {
      setExporting(false)
    }
  }

  async function pickBackup() {
    setSavingKey('pick-backup')
    try {
      const result = await api.pickBackup()
      if (result.cancelled) return
      setBackupSealed(Boolean(result.sealed))
      setBackupInfo(result.info ?? null)
      setBackupPath(result.path ?? '')
      setBackupPassword('')
    } catch (error) {
      toast.error(
        t('无法读取备份'),
        error instanceof ApiError ? error.message : t('文件可能已损坏'),
      )
    } finally {
      setSavingKey('')
    }
  }

  async function checkBackup() {
    if (checkingBackup) return
    if (!backupPassword) {
      toast.warning(t('请输入备份密码'))
      return
    }
    setCheckingBackup(true)
    try {
      const result = await api.previewBackup(backupPassword)
      setBackupInfo(result.info)
      toast.success(t('备份已解锁'), t('可以确认内容后覆盖恢复了。'))
    } catch (error) {
      setBackupInfo(null)
      setBackupSealed(true)
      toast.error(t('无法解锁备份'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setCheckingBackup(false)
    }
  }

  async function restoreBackup() {
    if (!backupInfo || restoring) return
    if (!backupPassword) {
      toast.warning(t('请输入备份的打开密码'))
      return
    }
    setRestoring(true)
    try {
      const result = await api.restoreBackup(backupPassword)
      toast.success(
        t('备份已恢复'),
        result.auto_backup
          ? t('恢复前的数据已自动备份至：\n{path}', {
              path: shortPath(result.auto_backup),
            })
          : t('密码库已替换为备份内容'),
        { duration: 9000 },
      )
      setBackupInfo(null)
      setBackupPassword('')
      onRestored(result.state)
      onOpenChange(false)
    } catch (error) {
      toast.error(t('恢复失败'), error instanceof ApiError ? error.message : t('请重试'))
    } finally {
      setRestoring(false)
    }
  }

  async function copyPath(path: string) {
    try {
      await copyText(path)
      toast.success(t('路径已复制'))
    } catch {
      toast.error(t('复制失败'))
    }
  }

  const securityBoundary = [
    {
      icon: ShieldCheck,
      title: t('字段级 AES-256-GCM'),
      detail: t('每个加密字段独立密文，AAD 绑定记录与字段，防篡改与拼接。'),
    },
    {
      icon: KeyRound,
      title: t('随机数据密钥'),
      detail: t('DEK 只存在于解锁后的内存中，磁盘上仅有被主密码包裹的版本。'),
    },
    {
      icon: Lock,
      title: t('自动锁定'),
      detail: t('超时或手动锁定会清除内存密钥，后续操作需要重新输入打开密码。'),
    },
    {
      icon: FileKey2,
      title: t('恢复密钥独立包裹'),
      detail: t('恢复码经 PBKDF2 派生另一把 KEK，同样只包裹 DEK，不保存明文。'),
    },
  ]

  return (
    <>
      <ModalFrame
        open={open}
        onOpenChange={onOpenChange}
        icon={<Settings2 className="size-5" />}
        title={t('设置')}
        description={t('所有设置即时保存。安全与数据操作只影响这台电脑上的本地密码库。')}
        width="880px"
        bodyClassName="max-h-[68vh] overflow-y-auto pr-1"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <Segmented value={tab} onChange={(value) => setTab(value)} items={tabItems} />
          <span className="text-[0.6875rem] text-ice-600">
            {savingKey ? (
              <span className="inline-flex items-center gap-1.5 text-[var(--msv-accent-text)]">
                <Spinner className="size-2.5" />
                {t('正在保存…')}
              </span>
            ) : (
              t('MedSafeVault · 本地加密')
            )}
          </span>
        </div>

        {tab === 'general' && (
          <div className="space-y-3 animate-fade-in">
            <Section title={t('外观')}>
              <Row
                title={t('主题模式')}
                description={t(
                  '跟随系统设置，或在亮色与暗色之间手动切换。选择会保存在本机，下次启动自动应用。',
                )}
              >
                <Segmented
                  value={theme}
                  onChange={onTheme}
                  items={[
                    { value: 'system', label: t('跟随系统') },
                    { value: 'light', label: t('亮色') },
                    { value: 'dark', label: t('暗色') },
                  ]}
                />
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={t('界面语言')}
                description={t('首次启动跟随系统语言；切换后会立即生效并保存在本机。')}
              >
                <Segmented
                  value={locale}
                  onChange={onLocale}
                  items={[
                    { value: 'zh', label: '中文' },
                    { value: 'en', label: 'English' },
                  ]}
                />
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={t('主题配色')}
                description={t('配色会同时适配亮色与暗色，所有色值都按对比度校准过。')}
              >
                <div className="flex items-center gap-1.5">
                  {ACCENT_OPTIONS.map((option) => {
                    const active = settings.accent === option.id
                    return (
                      <Tip key={option.id} text={t(option.name)}>
                        <button
                          type="button"
                          data-accent={option.id}
                          aria-label={t(option.name)}
                          aria-pressed={active}
                          onClick={() => updateSettings({ accent: option.id }, 'accent')}
                          className={cn(
                            'grid size-7 place-items-center rounded-full border-2 transition',
                            active
                              ? 'border-[var(--msv-accent-text)]'
                              : 'border-transparent hover:border-line-strong',
                          )}
                        >
                          <span
                            className="size-4 rounded-full"
                            style={{ background: 'var(--msv-accent)' }}
                          />
                        </button>
                      </Tip>
                    )
                  })}
                </div>
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <Type className="size-3.5 text-[var(--msv-accent-text)]" />
                    {t('界面字体')}
                  </span>
                }
                description={t('留空使用系统默认；列表来自本机已安装的字体。')}
              >
                <div className="flex items-center gap-1.5">
                  <SelectMenu
                    ariaLabel={t('界面字体')}
                    className="h-8 w-[190px] text-[12px]"
                    value={settings.ui_font}
                    items={uiFontItems}
                    onChange={(value) => updateSettings({ ui_font: value }, 'ui_font')}
                  />
                  <IconButton
                    label={t('读取系统字体')}
                    tip={t('读取系统字体')}
                    onPress={loadFonts}
                    disabled={readingFonts}
                  >
                    {readingFonts ? <Spinner className="size-3.5" /> : <RefreshCw className="size-4" />}
                  </IconButton>
                </div>
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <Terminal className="size-3.5 text-[var(--msv-accent-text)]" />
                    {t('代码字体')}
                  </span>
                }
                description={t('用于列表中的端口、地址、账号与密码等等宽文本。')}
              >
                <SelectMenu
                  ariaLabel={t('代码字体')}
                  className="h-8 w-[230px] font-mono text-[12px]"
                  value={settings.code_font}
                  items={codeFontItems}
                  onChange={(value) => updateSettings({ code_font: value }, 'code_font')}
                />
              </Row>
            </Section>

            <Section
              title={t('自动锁定')}
              description={t('计时从最后一次键鼠操作开始；锁定时会立即清除内存中的数据密钥。')}
            >
              <Row
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-3.5 text-[var(--msv-accent-text)]" />
                    {t('无操作后自动锁定')}
                  </span>
                }
                description={t(
                  '建议在信息科共用电脑上设为 3–5 分钟；设为「不自动锁定」仅在专用终端上使用。',
                )}
              >
                <SelectMenu
                  className="h-8 w-[150px] text-[0.75rem]"
                  ariaLabel={t('无操作后自动锁定')}
                  value={String(settings.auto_lock_minutes)}
                  items={[
                    { value: '0', label: t('不自动锁定') },
                    ...[1, 3, 5, 10, 15, 30, 60, 120].map((minutes) => ({
                      value: String(minutes),
                      label: t('{n} 分钟', { n: minutes }),
                    })),
                    ...(![0, 1, 3, 5, 10, 15, 30, 60, 120].includes(
                      settings.auto_lock_minutes,
                    )
                      ? [
                          {
                            value: String(settings.auto_lock_minutes),
                            label: t('{n} 分钟', { n: settings.auto_lock_minutes }),
                          },
                        ]
                      : []),
                  ]}
                  onChange={(value) =>
                    updateSettings({ auto_lock_minutes: Number(value) }, 'auto_lock')
                  }
                />
              </Row>
            </Section>

            <Section
              title={t('显示与隐私')}
              description={t('这里是全局默认值；单个页面中标记为「掩码」的列始终隐藏。')}
            >
              <Row
                title={t('在表格中隐藏用户名')}
                description={t('用户名仍会加密存储，仅默认显示为圆点。')}
              >
                <Switch
                  checked={settings.mask_usernames}
                  onChange={(checked) =>
                    updateSettings({ mask_usernames: checked }, 'mask_usernames')
                  }
                />
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={t('隐藏地址类字段')}
                description={t('服务器地址、管理地址与带外地址默认以圆点显示。')}
              >
                <Switch
                  checked={settings.mask_addresses}
                  onChange={(checked) =>
                    updateSettings({ mask_addresses: checked }, 'mask_addresses')
                  }
                />
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={t('紧凑行高')}
                description={t('每行高度从 48px 缩小到 38px，一屏显示更多记录。')}
              >
                <Switch
                  checked={settings.compact_rows}
                  onChange={(checked) => updateSettings({ compact_rows: checked }, 'compact_rows')}
                />
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <Type className="size-3.5 text-[var(--msv-accent-text)]" />
                    {t('列表字体')}
                  </span>
                }
                description={t('等宽字体让端口、IP 与账号对齐，更易分辨 0/O 与 1/l。')}
              >
                <Segmented
                  value={settings.table_font}
                  onChange={(value) => updateSettings({ table_font: value }, 'table_font')}
                  items={[
                    { value: 'mono', label: t('等宽') },
                    { value: 'sans', label: t('常规') },
                  ]}
                />
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <Monitor className="size-3.5 text-[var(--msv-accent-text)]" />
                    {t('界面大小')}
                  </span>
                }
                description={t('整体缩放界面，投影或高分屏上可以选择更大的布局。')}
              >
                <Segmented
                  value={settings.ui_scale}
                  onChange={(value) => updateSettings({ ui_scale: value }, 'ui_scale')}
                  items={[
                    { value: 'small', label: t('小') },
                    { value: 'standard', label: t('标准') },
                    { value: 'large', label: t('大') },
                  ]}
                />
              </Row>
            </Section>

            <Section
              title={t('远程连接')}
              description={t(
                '这些是全局默认值；连接单条记录时，还可以在列表的连接菜单里临时改选方式。',
              )}
            >
              <Row
                title={
                  <span className="inline-flex items-center gap-1.5">
                    <Terminal className="size-3.5 text-[var(--msv-accent-text)]" />
                    {t('SSH 连接程序')}
                  </span>
                }
                description={t('「自动」优先使用内置终端，找不到时再尝试其他已安装程序。')}
              >
                <SelectMenu
                  ariaLabel={t('SSH 连接程序')}
                  className="h-8 w-[190px] text-[12px]"
                  value={settings.ssh_client}
                  items={[
                    { value: 'auto' as const, label: t('自动选择') },
                    { value: 'builtin' as const, label: t('内置终端') },
                    { value: 'securecrt' as const, label: 'SecureCRT' },
                    { value: 'putty' as const, label: 'PuTTY' },
                    { value: 'xshell' as const, label: 'Xshell' },
                    { value: 'openssh' as const, label: t('Windows 自带 OpenSSH') },
                  ]}
                  onChange={(value) => updateSettings({ ssh_client: value }, 'ssh_client')}
                />
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={t('Telnet 连接程序')}
                description={t('内置终端只支持 SSH，Telnet 会交给所选外部程序。')}
              >
                <SelectMenu
                  ariaLabel={t('Telnet 连接程序')}
                  className="h-8 w-[190px] text-[12px]"
                  value={settings.telnet_client}
                  items={[
                    { value: 'auto' as const, label: t('自动选择') },
                    { value: 'securecrt' as const, label: 'SecureCRT' },
                    { value: 'putty' as const, label: 'PuTTY' },
                    { value: 'telnet' as const, label: t('Windows 自带 Telnet') },
                  ]}
                  onChange={(value) => updateSettings({ telnet_client: value }, 'telnet_client')}
                />
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={t('FTP / SFTP 文件传输')}
                description={t('内置双栏文件管理，或交由 WinSCP 打开。')}
              >
                <SelectMenu
                  ariaLabel={t('FTP / SFTP 文件传输')}
                  className="h-8 w-[190px] text-[12px]"
                  value={settings.file_client}
                  items={[
                    { value: 'builtin' as const, label: t('内置文件管理') },
                    { value: 'winscp' as const, label: 'WinSCP' },
                  ]}
                  onChange={(value) => updateSettings({ file_client: value }, 'file_client')}
                />
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={t('VNC 远程桌面')}
                description={t('内置画布不需要安装客户端；外部模式调用 VNC Viewer。')}
              >
                <SelectMenu
                  ariaLabel={t('VNC 远程桌面')}
                  className="h-8 w-[190px] text-[12px]"
                  value={settings.vnc_client}
                  items={[
                    { value: 'builtin' as const, label: t('内置画布') },
                    { value: 'external' as const, label: 'VNC Viewer' },
                  ]}
                  onChange={(value) => updateSettings({ vnc_client: value }, 'vnc_client')}
                />
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={t('RDP 凭据填充')}
                description={t(
                  '始终用系统 mstsc 打开；填写密码时会临时写入 Windows 凭据，mstsc 结束后立即删除。',
                )}
              >
                <SelectMenu
                  ariaLabel={t('RDP 凭据填充')}
                  className="h-8 w-[190px] text-[12px]"
                  value={settings.rdp_fill}
                  items={[
                    { value: 'user' as const, label: t('仅用户名') },
                    { value: 'password' as const, label: t('用户名和密码') },
                    { value: 'none' as const, label: t('不填充') },
                  ]}
                  onChange={(value) => updateSettings({ rdp_fill: value }, 'rdp_fill')}
                />
              </Row>
            </Section>

            <Section
              title={t('外部程序路径')}
              description={t('留空时会在注册表与常见安装位置查找；找不到才会回退到内置功能。')}
            >
              {programRows.map((item, index) => (
                <div key={item.key}>
                  {index > 0 && <div className="h-px bg-line/70" />}
                  <Row
                    title={item.label}
                    description={
                      item.path ? shortPath(item.path, 60) : t('未配置，将自动查找 {exe}', { exe: item.exe })
                    }
                  >
                    <button
                      type="button"
                      onClick={() => chooseProgram(item.key, item.label)}
                      disabled={savingKey === item.key}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[0.71875rem] text-ice-300 transition hover:border-line-strong hover:bg-[var(--msv-tint)] disabled:opacity-50"
                    >
                      {savingKey === item.key ? (
                        <Spinner className="size-3" />
                      ) : (
                        <FolderOpen className="size-3.5" />
                      )}
                      {t('选择程序')}
                    </button>
                  </Row>
                </div>
              ))}
            </Section>

            <Section
              title={t('关闭按钮')}
              description={t('点击窗口右上角的关闭按钮时，默认怎么处理这个窗口。')}
            >
              <Row
                title={t('关闭方式')}
                description={t('最小化后程序继续在后台运行，远程连接也会保持。')}
              >
                <SelectMenu
                  ariaLabel={t('关闭方式')}
                  className="h-8 w-[190px] text-[12px]"
                  value={settings.close_action}
                  items={[
                    { value: 'tray' as const, label: t('最小化到小图标区') },
                    { value: 'quit' as const, label: t('直接退出程序') },
                  ]}
                  onChange={(value) => updateSettings({ close_action: value }, 'close_action')}
                />
              </Row>
              <div className="h-px bg-line/70" />
              <Row
                title={t('每次关闭时询问')}
                description={t('关闭后小图标出现在任务栏通知区域，右键可打开、锁定或退出。')}
              >
                <Switch
                  checked={settings.close_confirm}
                  onChange={(checked) => updateSettings({ close_confirm: checked }, 'close_confirm')}
                />
              </Row>
            </Section>
          </div>
        )}

        {tab === 'security' && (
          <div className="space-y-3 animate-fade-in">
            <Section
              title={t('修改打开密码')}
              description={t('只重新包裹数据密钥，不会重写数据库中的每条密文，因此修改很快。')}
            >
              <form onSubmit={changePassword} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="field-label" htmlFor="old-password">
                    {t('当前密码')}
                  </label>
                  <input
                    id="old-password"
                    className="msv-input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={oldPassword}
                    onChange={(event) => {
                      setOldPassword(event.target.value)
                      setPasswordError('')
                    }}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="new-password">
                    {t('新密码')}
                  </label>
                  <input
                    id="new-password"
                    className="msv-input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => {
                      setNewPassword(event.target.value)
                      setPasswordError('')
                    }}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="confirm-password">
                    {t('确认新密码')}
                  </label>
                  <input
                    id="confirm-password"
                    className="msv-input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value)
                      setPasswordError('')
                    }}
                  />
                </div>
                {newPassword && (
                  <div className="sm:col-span-2">
                    <StrengthMeter value={newPassword} compact />
                  </div>
                )}
                <div className="flex items-end justify-between gap-2 sm:col-span-3">
                  <label className="flex cursor-pointer items-center gap-2 text-[0.71875rem] text-ice-500">
                    <input
                      type="checkbox"
                      className="msv-check"
                      checked={showPassword}
                      onChange={(event) => setShowPassword(event.target.checked)}
                    />
                    {t('显示密码')}
                    <span className="text-ice-600">
                      {t('· 强度 {label}', { label: strength.label })}
                    </span>
                  </label>
                  <button
                    type="submit"
                    disabled={changing}
                    className="btn-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[0.71875rem] font-semibold transition hover:brightness-105 disabled:opacity-50"
                  >
                    {changing && <Spinner className="size-3" />}
                    <Check className="size-3.5" />
                    {t('更新密码')}
                  </button>
                </div>
              </form>
              {passwordError && (
                <div className="mt-2.5 rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3 py-2 text-[0.71875rem] text-rose-200">
                  {passwordError}
                </div>
              )}
            </Section>

            <Section
              title={t('恢复密钥')}
              description={t('恢复密钥可以在忘记打开密码时重设密码。它不依赖旧密码，请离线保存。')}
              action={
                <button
                  type="button"
                  onClick={rotateRecovery}
                  disabled={rotating}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-2.5 text-[0.71875rem] text-amber-200 transition hover:bg-amber-400/[0.12] disabled:opacity-50"
                >
                  {rotating ? <Spinner className="size-3" /> : <RotateCcw className="size-3.5" />}
                  {t('重新生成')}
                </button>
              }
            >
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2.5">
                <span className={recoveryStatus.enabled ? 'chip chip-mint' : 'chip chip-danger'}>
                  <ShieldCheck className="size-3" />
                  {recoveryStatus.enabled ? t('已启用') : t('未启用')}
                </span>
                <span className="text-[0.71875rem] text-ice-500">
                  {t('第 {n} 代', { n: recoveryStatus.generation })}
                </span>
                <span className="text-[0.71875rem] text-ice-500">
                  {t('创建于 {date}', {
                    date: recoveryStatus.created_at
                      ? formatDateTime(recoveryStatus.created_at)
                      : '—',
                  })}
                </span>
              </div>
              <p className="mt-2.5 flex items-start gap-2 text-[0.71875rem] leading-relaxed text-ice-600">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                {t(
                  '重新生成会使所有旧的恢复密钥文件立即失效。生成后请立刻保存新的 .msvkey 文件，并删除旧文件以免混淆。',
                )}
              </p>
            </Section>

            <Section title={t('安全边界')} description={t('这些机制共同保护数据库文件本身。')}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {securityBoundary.map((item) => (
                  <div key={item.title} className="rounded-lg border border-line bg-[var(--msv-tint)] p-3">
                    <div className="flex items-center gap-1.5 text-[0.71875rem] font-medium text-ice-300">
                      <item.icon className="size-3.5 text-[var(--msv-accent-text)]" />
                      {item.title}
                    </div>
                    <p className="mt-1 text-[0.6875rem] leading-relaxed text-ice-600">{item.detail}</p>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}

        {tab === 'data' && (
          <div className="space-y-3 animate-fade-in">
            <Section
              title={t('加密备份')}
              description={t(
                '导出时设置一个备份密码，整个文件（含页面结构与记录条数）都会被它加密；导入时必须验证该密码。',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBackupDialogOpen(true)}
                  disabled={exporting}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--msv-accent)_28%,transparent)] bg-[var(--msv-accent-soft)] px-3 text-[0.75rem] text-[var(--msv-accent-text)] transition hover:brightness-105 disabled:opacity-50"
                >
                  {exporting ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}
                  {t('导出完整备份')}
                </button>
                <button
                  type="button"
                  onClick={pickBackup}
                  disabled={savingKey === 'pick-backup'}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[0.75rem] text-ice-300 transition hover:border-line-strong hover:bg-[var(--msv-tint)] disabled:opacity-50"
                >
                  {savingKey === 'pick-backup' ? <Spinner className="size-3.5" /> : <Upload className="size-3.5" />}
                  {t('从备份恢复')}
                </button>
                <Tip text={t('打开数据目录')}>
                  <button
                    type="button"
                    onClick={() => api.openDataDir().catch(() => undefined)}
                    className="grid size-9 place-items-center rounded-lg border border-line text-ice-500 transition hover:border-line-strong hover:text-ice-200"
                  >
                    <FolderOpen className="size-4" />
                  </button>
                </Tip>
              </div>
              <p className="mt-2 text-[0.6875rem] leading-relaxed text-ice-600">
                {t('建议在每次批量导入、修改页面结构或升级版本前导出一次，并保存到离线介质。')}
              </p>
            </Section>

            {(backupInfo || backupSealed) && (
              <Section
                title={t('确认恢复备份')}
                description={t(
                  '恢复会用备份内容替换当前密码库。恢复前会自动生成一份当前数据的加密备份。',
                )}
              >
                <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-[0.71875rem] leading-relaxed text-amber-100">
                  <div className="mb-1 inline-flex items-center gap-1.5 font-medium text-amber-200">
                    <AlertTriangle className="size-3.5" />
                    {t('这会覆盖当前所有页面、记录与历史')}
                  </div>
                  {backupPath && (
                    <div className="break-all">
                      {t('来源：{path}', { path: backupPath })}
                    </div>
                  )}
                  {backupSealed && !backupInfo && (
                    <div>{t('该文件已加密：输入备份密码后才能看到内容。')}</div>
                  )}
                </div>

                {backupInfo && (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: t('创建时间'), value: formatDateTime(backupInfo.created_at) },
                    { label: t('页面'), value: t('{n} 个', { n: backupInfo.pages }) },
                    { label: t('记录'), value: t('{n} 条', { n: backupInfo.records }) },
                    { label: t('历史'), value: t('{n} 条', { n: backupInfo.history }) },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-line bg-[var(--msv-tint)] px-2.5 py-2">
                      <div className="text-[0.6875rem] text-ice-600">{item.label}</div>
                      <div className="mt-0.5 truncate font-mono text-[0.71875rem] text-ice-300">{item.value}</div>
                    </div>
                  ))}
                </div>
                )}

                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label className="field-label" htmlFor="backup-password">
                      {backupSealed ? t('备份密码') : t('备份的打开密码')}
                    </label>
                    <input
                      id="backup-password"
                      className="msv-input"
                      type="password"
                      autoComplete="off"
                      placeholder={
                        backupSealed
                          ? t('输入导出该备份时设置的备份密码')
                          : t('输入导出该备份时使用的打开密码')
                      }
                      value={backupPassword}
                      onChange={(event) => setBackupPassword(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && backupSealed && !backupInfo) {
                          event.preventDefault()
                          void checkBackup()
                        }
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {backupSealed && !backupInfo && (
                      <button
                        type="button"
                        onClick={checkBackup}
                        disabled={checkingBackup}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--msv-accent)_28%,transparent)] bg-[var(--msv-accent-soft)] px-3.5 text-[0.75rem] text-[var(--msv-accent-text)] transition hover:brightness-105 disabled:opacity-50"
                      >
                        {checkingBackup ? <Spinner className="size-3.5" /> : <KeyRound className="size-3.5" />}
                        {t('验证并预览')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setBackupInfo(null)
                        setBackupPassword('')
                        setBackupSealed(false)
                        api.cancelBackup().catch(() => undefined)
                      }}
                      className="h-9 rounded-lg border border-line px-3.5 text-[0.75rem] text-ice-400 transition hover:border-line-strong hover:text-ice-200"
                    >
                      {t('取消')}
                    </button>
                    <button
                      type="button"
                      onClick={restoreBackup}
                      disabled={restoring || !backupInfo}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--danger)] px-3.5 text-[0.75rem] font-medium text-[var(--danger-foreground)] transition hover:brightness-110 disabled:opacity-50"
                    >
                      {restoring && <Spinner className="size-3.5" />}
                      {t('覆盖并恢复')}
                    </button>
                  </div>
                </div>
              </Section>
            )}

            <Section
              title={t('数据目录')}
              description={t('密码库、日志与备份都保存在这里。修改后重启生效，退出时自动搬移文件。')}
              action={
                <button
                  type="button"
                  onClick={() => {
                    api.openDataDir().catch(() => undefined)
                  }}
                  className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[0.71875rem] text-ice-400 transition hover:border-line-strong hover:text-ice-200"
                >
                  <FolderOpen className="size-3.5" />
                  {t('打开目录')}
                </button>
              }
            >
              <div className="space-y-2">
                {locationOptions.map((option) => {
                  const active = location?.mode === option.mode
                  const Icon = option.icon
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      disabled={!location || locationBusy || Boolean(location.env_override)}
                      onClick={() =>
                        option.mode === 'custom'
                          ? requestLocation('custom', customPath)
                          : requestLocation(option.mode)
                      }
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition',
                        active
                          ? 'border-[color-mix(in_srgb,var(--msv-accent)_40%,transparent)] bg-[var(--msv-accent-soft)]'
                          : 'border-line bg-[var(--msv-tint)] hover:border-line-strong',
                        (!location || location.env_override) && 'opacity-60',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border',
                          active
                            ? 'border-[color-mix(in_srgb,var(--msv-accent)_45%,transparent)] text-[var(--msv-accent-text)]'
                            : 'border-line text-ice-600',
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-[0.78125rem] font-medium text-ice-200">{option.title}</span>
                          {active && (
                            <span className="chip !py-0 !text-[0.625rem]">{t('当前')}</span>
                          )}
                        </span>
                        <span
                          className="mt-0.5 block truncate font-mono text-[0.71875rem] text-ice-500"
                          title={option.path}
                        >
                          {option.path || '—'}
                        </span>
                        <span className="mt-0.5 block text-[0.71875rem] leading-relaxed text-ice-600">
                          {option.hint}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  className="msv-input min-w-0 flex-1"
                  value={customPath}
                  onChange={(event) => setCustomPath(event.target.value)}
                  placeholder={t('例如 D:\\科室资料\\MedSafeVault数据')}
                  aria-label={t('自定义数据目录')}
                />
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={pickFolder}
                    className="h-9 rounded-lg border border-line px-3 text-[0.75rem] text-ice-300 transition hover:border-line-strong hover:text-ice-100"
                  >
                    {t('浏览…')}
                  </button>
                  <button
                    type="button"
                    disabled={!customPath.trim() || locationBusy}
                    onClick={() => requestLocation('custom', customPath.trim())}
                    className="h-9 rounded-lg bg-[var(--msv-accent)] px-3.5 text-[0.75rem] font-medium text-[var(--msv-accent-contrast)] transition hover:brightness-110 disabled:opacity-50"
                  >
                    {t('使用此目录')}
                  </button>
                </div>
              </div>

              {location?.env_override && (
                <div className="mt-2.5 rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2 text-[0.71875rem] leading-relaxed text-ice-500">
                  <span className="font-mono text-ice-300">MEDSAFE_DATA_DIR</span>
                  {' = '}
                  <span className="break-all font-mono">{location.env_override}</span>
                  <p className="mt-1 text-ice-600">
                    {t('环境变量优先，取消该变量后才能在这里选择数据目录。')}
                  </p>
                </div>
              )}

              {location?.pending && (
                <div className="mt-2.5 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[0.75rem] font-medium text-amber-200">
                        {t('新目录已记录，重启后生效')}
                      </div>
                      <div
                        className="mt-0.5 break-all font-mono text-[0.71875rem] text-amber-100/90"
                        title={location.pending.path}
                      >
                        {location.pending.path}
                      </div>
                      <p className="mt-1 text-[0.71875rem] leading-relaxed text-amber-200/80">
                        {t('退出程序时会自动复制密码库与备份并校验，原目录改名保留，不会直接删除。')}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={quitAndApply}
                          className="h-8 rounded-lg bg-amber-400/90 px-3 text-[0.71875rem] font-medium text-amber-950 transition hover:bg-amber-300"
                        >
                          {t('退出并应用')}
                        </button>
                        <button
                          type="button"
                          onClick={cancelLocationRequest}
                          className="h-8 rounded-lg border border-amber-400/30 px-3 text-[0.71875rem] text-amber-200 transition hover:bg-amber-400/10"
                        >
                          {t('取消变更')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 space-y-1.5">
                {[
                  { label: t('数据目录'), value: location?.path ?? state.data_dir },
                  { label: t('数据库文件'), value: state.db_file },
                  { label: t('占用空间'), value: formatBytes(location?.size_bytes ?? 0) },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-2 rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2"
                  >
                    <span className="w-20 shrink-0 truncate text-[0.71875rem] text-ice-600">{item.label}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[0.71875rem] text-ice-400" title={item.value}>
                      {item.value || '—'}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyPath(item.value)}
                      className="grid size-6 shrink-0 place-items-center rounded text-ice-600 transition hover:bg-[var(--msv-tint)] hover:text-ice-300"
                      aria-label={t('复制{label}', { label: item.label })}
                    >
                      <Copy className="size-3" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-2.5 rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Database className="size-3.5 shrink-0 text-ice-600" />
                  <span className="shrink-0 text-[0.71875rem] text-ice-300">{t('配置文件')}</span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[0.71875rem] text-ice-500"
                    title={location?.config_path}
                  >
                    {location?.config_path || '—'}
                  </span>
                </div>
                <p className="mt-1 text-[0.71875rem] leading-relaxed text-ice-600">
                  {t('配置文件记录数据目录位置，首次启动时自动创建在程序目录（{dir}）；该目录不可写时改存到 %APPDATA%\\MedSafeVault。', {
                    dir: location?.app_dir || '',
                  })}
                </p>
                <p className="mt-1 text-[0.71875rem] leading-relaxed text-ice-600">
                  {t('浏览器缓存目录 webview 不参与搬移，它会在新位置自动重建。')}
                </p>
                {location && !location.config_writable && (
                  <p className="mt-1 text-[0.71875rem] leading-relaxed text-amber-200">
                    {t('配置文件所在目录不可写，数据目录设置无法保存。')}
                  </p>
                )}
              </div>

              <div className="mt-2.5">
                <div className="flex items-center gap-1.5 text-[0.75rem] font-medium text-ice-300">
                  <Terminal className="size-3.5" />
                  {t('环境变量')}
                </div>
                <div className="mt-1.5 space-y-1.5">
                  {envRows.map((row) => (
                    <div
                      key={row.name}
                      className="rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <code className="shrink-0 font-mono text-[0.71875rem] text-[var(--msv-accent-text)]">
                          {row.name}
                        </code>
                        <span
                          className="min-w-0 truncate font-mono text-[0.71875rem] text-ice-500"
                          title={row.value || ''}
                        >
                          {row.value || t('未设置')}
                        </span>
                      </div>
                      <p className="mt-1 text-[0.71875rem] leading-relaxed text-ice-600">
                        {row.description}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[0.71875rem] leading-relaxed text-ice-600">
                  {t('环境变量只影响本机当前用户或启动脚本，不写入注册表。')}
                </p>
              </div>
            </Section>
          </div>
        )}

        {tab === 'about' && (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-center justify-between rounded-xl border border-line bg-[linear-gradient(120deg,var(--msv-accent-soft),transparent)] px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl border border-[color-mix(in_srgb,var(--msv-accent)_25%,transparent)] bg-[var(--msv-accent-soft)] text-[var(--msv-accent-text)]">
                  <ShieldCheck className="size-5" />
                </span>
                <div>
                  <div className="font-display text-[0.9375rem] font-semibold text-ice-200">
                    MedSafeVault <span className="text-[var(--msv-accent-text)]">v{state.version}</span>
                  </div>
                  <div className="text-[0.71875rem] text-ice-600">
                    {t('医安密管平台 · 本地桌面版')}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAboutLoading(true)
                  api
                    .getAbout()
                    .then((result) => setAbout(result.about))
                    .catch(() => undefined)
                    .finally(() => setAboutLoading(false))
                }}
                className="grid size-8 place-items-center rounded-lg border border-line text-ice-500 transition hover:border-line-strong hover:text-ice-200"
                aria-label={t('刷新')}
              >
                <RefreshCw className={cn('size-3.5', aboutLoading && 'animate-spin')} />
              </button>
            </div>

            {aboutLoading && !about ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="skeleton h-16 rounded-lg" />
                ))}
              </div>
            ) : about?.stats ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: t('页面'), value: about.stats.pages, icon: Database },
                  { label: t('记录'), value: about.stats.records, icon: FileArchive },
                  { label: t('加密字段'), value: about.stats.secrets, icon: Lock },
                  { label: t('历史快照'), value: about.stats.history, icon: Clock },
                  { label: t('回收站页面'), value: about.stats.recycle_pages, icon: RotateCcw },
                  { label: t('回收站记录'), value: about.stats.recycle_records, icon: RotateCcw },
                  { label: t('数据库大小'), value: formatBytes(about.db_size), icon: HardDrive },
                  { label: 'Python', value: about.python, icon: Terminal },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[0.6875rem] text-ice-600">
                      <item.icon className="size-2.5" />
                      {item.label}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[0.875rem] text-ice-200">{item.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-line bg-[var(--msv-tint)] px-3 py-2.5 text-[0.71875rem] text-ice-500">
                {t('密码库已锁定，解锁后可查看数据统计。')}
              </div>
            )}

            <Section title={t('运行环境')} description={t('用于排查兼容性问题，可复制后反馈。')}>
              <div className="space-y-1.5 font-mono text-[0.71875rem]">
                {[
                  { label: t('版本'), value: about?.version ?? state.version },
                  {
                    label: t('加密'),
                    value: about?.crypto ?? 'AES-256-GCM / PBKDF2-SHA256 (600,000)',
                  },
                  { label: t('系统'), value: about?.platform ?? navigator.userAgent },
                  { label: t('数据库'), value: about?.db_file ?? state.db_file },
                  { label: t('数据目录'), value: about?.data_dir ?? state.data_dir },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-start gap-2 rounded border border-line/70 bg-[var(--msv-tint)] px-2.5 py-1.5"
                  >
                    <span className="w-14 shrink-0 text-ice-600">{item.label}</span>
                    <span className="min-w-0 flex-1 break-all text-ice-400">{item.value}</span>
                  </div>
                ))}
              </div>
            </Section>

            {about && (
              <div className="flex items-center justify-between text-[0.6875rem] text-ice-600">
                <span className="inline-flex items-center gap-1.5">
                  <Monitor className="size-3" />
                  {t('单文件桌面应用 · 数据不离开本机')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ServerCog className="size-3" />
                  {t('数据库 {size}', { size: formatBytes(about.db_size) })}
                </span>
              </div>
            )}
          </div>
        )}
      </ModalFrame>

      <BackupPasswordDialog
        open={backupDialogOpen}
        onOpenChange={setBackupDialogOpen}
        onConfirm={runExport}
      />
      <RecoveryCodeDialog
        open={recoveryOpen}
        info={recoveryInfo}
        mode="rotate"
        onDone={async () => {
          setRecoveryOpen(false)
          try {
            const result = await api.getRecoveryStatus()
            setRecoveryStatus(result.recovery)
            toast.success(t('恢复密钥已更新'), t('旧的恢复密钥文件已失效'))
          } catch {
            /* status will refresh on next open */
          }
        }}
      />
    </>
  )
}
