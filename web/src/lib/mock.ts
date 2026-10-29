/**
 * Browser-only demo backend. It mirrors the shape of `backend/api.py` so the
 * interface can be developed and reviewed without launching pywebview.
 * Enabled by `?demo=setup`, `?demo=locked` or `?demo=unlocked`, or automatically
 * when running Vite outside the desktop shell.
 */
import type {
  AboutInfo,
  BackupInfo,
  Bootstrap,
  Column,
  DataLocation,
  ExcelPreview,
  HistoryItem,
  HistoryList,
  LocalListing,
  Page,
  PageTemplate,
  RecordDetail,
  RecordList,
  RecycleList,
  RemoteEntry,
  RemoteListing,
  Settings,
  StateInfo,
  UndoState,
} from './types'
import { translate as t } from './i18n'
import { passwordStrength, sleep } from './utils'

const MASK = '••••••••'
const ISO = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
const ago = (minutes: number) => ISO(new Date(Date.now() - minutes * 60_000))

let colSeq = 1

interface ColumnOptions {
  type?: Column['type']
  encrypted?: boolean
  masked?: boolean
  width?: number
  required?: boolean
  visible?: boolean
  options?: string[]
  placeholder?: string
}

function col(key: string, label: string, options: ColumnOptions = {}): Column {
  const type = options.type ?? 'text'
  return {
    id: colSeq++,
    key,
    label,
    type,
    encrypted: true,
    secret: type === 'password',
    masked: options.masked ?? false,
    width: options.width ?? 160,
    visible: options.visible ?? true,
    required: options.required ?? false,
    options: options.options ?? [],
    placeholder: options.placeholder ?? '',
  }
}

const serverColumns = (): Column[] => [
  col('type', '类型', { type: 'select', width: 100, options: ['物理机', '虚拟机', '云主机', '其他'] }),
  col('address', '服务器地址', { width: 150, placeholder: '203.0.113.10' }),
  col('app', '应用名称', { width: 190 }),
  col('os', '操作系统', { width: 160, placeholder: 'CentOS 7 / Windows' }),
  col('username', '用户名', { encrypted: true, width: 140 }),
  col('password', '密码', { type: 'password', encrypted: true, masked: true, width: 150 }),
  col('port', '端口', { width: 80, placeholder: '22' }),
  col('oob', '带外地址', { width: 150 }),
  col('oob_user', '带外用户名', { encrypted: true, width: 140 }),
  col('oob_pass', '带外密码', { type: 'password', encrypted: true, masked: true, width: 140 }),
  col('note', '备注', { type: 'textarea', width: 240 }),
]

const networkColumns = (): Column[] => [
  col('type', '设备类型', {
    type: 'select',
    width: 110,
    options: ['交换机', '路由器', '防火墙', '负载均衡', '无线控制器', '其他'],
  }),
  col('address', '管理地址', { width: 150 }),
  col('app', '设备名称', { width: 190 }),
  col('os', '品牌型号', { width: 170 }),
  col('username', '用户名', { encrypted: true, width: 140 }),
  col('password', '密码', { type: 'password', encrypted: true, masked: true, width: 150 }),
  col('port', '端口', { width: 80 }),
  col('note', '备注', { type: 'textarea', width: 220 }),
]

const appColumns = (): Column[] => [
  col('app', '系统名称', { width: 210 }),
  col('address', '访问地址', { width: 230, placeholder: 'https://' }),
  col('username', '用户名', { encrypted: true, width: 160 }),
  col('password', '密码', { type: 'password', encrypted: true, masked: true, width: 180 }),
  col('note', '备注', { type: 'textarea', width: 250 }),
]

const databaseColumns = (): Column[] => [
  col('app', '实例名称', { width: 190 }),
  col('address', '主机地址', { width: 160 }),
  col('port', '端口', { width: 90, placeholder: '1972' }),
  col('username', '用户名', { encrypted: true, width: 150 }),
  col('password', '密码', { type: 'password', encrypted: true, masked: true, width: 170 }),
  col('note', '备注', { type: 'textarea', width: 250 }),
]

function templateColumns(columns: Column[]): Partial<Column>[] {
  return columns.map(({ id: _id, ...rest }) => rest)
}

const templates: PageTemplate[] = [
  {
    id: 'server',
    name: '服务器',
    icon: 'server',
    description: '物理机、虚拟机与云主机',
    columns: templateColumns(serverColumns()),
  },
  {
    id: 'network',
    name: '网络设备',
    icon: 'network',
    description: '交换机、路由器与安全设备',
    columns: templateColumns(networkColumns()),
  },
  {
    id: 'app',
    name: '应用系统',
    icon: 'app',
    description: '业务系统与网站账号',
    columns: templateColumns(appColumns()),
  },
  {
    id: 'database',
    name: '数据库',
    icon: 'database',
    description: '数据库实例与连接账号',
    columns: templateColumns(databaseColumns()),
  },
  {
    id: 'blank',
    name: '新页面',
    icon: 'grid',
    description: '从基础字段开始',
    columns: [
      col('app', '名称', { width: 200, required: true }),
      col('username', '用户名', { encrypted: true, width: 160 }),
      col('password', '密码', { type: 'password', encrypted: true, masked: true, width: 180 }),
      col('note', '备注', { type: 'textarea', width: 240 }),
    ],
  },
  {
    id: 'other',
    name: '其他账号',
    icon: 'key',
    description: '零散账号与密钥',
    columns: [
      col('app', '名称', { width: 200, required: true }),
      col('username', '用户名', { encrypted: true, width: 160 }),
      col('password', '密码', { type: 'password', encrypted: true, masked: true, width: 180 }),
      col('note', '备注', { type: 'textarea', width: 240 }),
    ],
  },
]

colSeq = 1

interface MockPage extends Page {
  _base: Column[]
}

interface MockRecord {
  id: number
  page_id: number
  data: Record<string, string>
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface InternalHistory extends HistoryItem {
  raw_before: Record<string, string>
  raw_after: Record<string, string>
}

const demoMode = new URLSearchParams(window.location.search).get('demo')
// ?demo=1&excel=locked shows the password prompt for an import, mirroring a
// workbook saved with an opening password.
const demoExcelLocked = new URLSearchParams(window.location.search).get('excel') === 'locked'
const DEMO_EXCEL_PASSWORD = 'Excel#2026secret'
const DEMO_EXCEL_FILE = 'C:\\Users\\CaiJianling\\Desktop\\服务器清单.xlsx'
const DEMO_EXCEL_LOCKED_FILE = 'C:\\Users\\CaiJianling\\Desktop\\加密清单.xlsx'

let initialized = demoMode !== 'setup'
let locked = demoMode === 'setup' || demoMode === 'locked'
let lockReason: string | null = demoMode === 'locked' ? 'auto' : null

const DEMO_PORTABLE_DIR = 'MedSafeVaultData'
export const DEMO_APPDATA_DIR = 'C:\\Users\\CaiJianling\\AppData\\Roaming\\MedSafeVault'

/** Demo stand-in for <app dir>/MedSafeVault.json (browser mode has no disk). */
let demoLocation = { mode: 'appdata', path: DEMO_APPDATA_DIR }
let demoPending: { mode: string; path: string; requested_at: string } | null = null

let settings: Settings = {
  auto_lock_minutes: 5,
  theme: 'system',
  securecrt_path: '',
  putty_path: '',
  xshell_path: '',
  winscp_path: '',
  vnc_viewer_path: '',
  ssh_client: 'auto',
  telnet_client: 'auto',
  file_client: 'builtin',
  vnc_client: 'builtin',
  rdp_fill: 'user',
  close_action: 'tray',
  close_confirm: true,
  table_font: 'mono',
  ui_scale: 'standard',
  accent: 'blue',
  ui_font: '',
  code_font: '',
  mask_usernames: false,
  mask_addresses: false,
  compact_rows: false,
}

/**
 * Browser-preview stand-ins for the built-in sessions. They keep an in-memory
 * transcript / directory tree per tab so the terminal overlay can be reviewed
 * without a real SSH/FTP server. Desktop builds never use this file.
 */
interface MockSession {
  id: string
  kind: 'ssh' | 'files' | 'vnc'
  protocol: string
  title: string
  target: string
  username: string
  password: string
  buffer: string
  pending: string
  dirs: Record<string, RemoteEntry[]>
  closed: boolean
}

let mockSessions: MockSession[] = []
let mockSessionSeq = 1

function dirEntry(name: string, size: number, isDir = false, daysAgo = 3): RemoteEntry {
  return { name, is_dir: isDir, size, mtime: Math.floor(Date.now() / 1000) - daysAgo * 86400 }
}

function demoDirs(protocol: string): Record<string, RemoteEntry[]> {
  if (protocol === 'FTP') {
    return {
      '/': [dirEntry('public', 0, true), dirEntry('upload', 0, true), dirEntry('welcome.txt', 720)],
      '/public': [dirEntry('notice-2026.txt', 1480), dirEntry('images', 0, true, 6)],
      '/public/images': [dirEntry('banner.png', 92_400, false, 9)],
      '/upload': [],
    }
  }
  return {
    '/': [dirEntry('etc', 0, true, 21), dirEntry('opt', 0, true, 21), dirEntry('var', 0, true, 8)],
    '/etc': [dirEntry('app.conf', 2140, false, 4), dirEntry('hosts', 380, false, 30)],
    '/opt': [dirEntry('app', 0, true, 4), dirEntry('backup', 0, true, 12)],
    '/opt/app': [
      dirEntry('config', 0, true, 4),
      dirEntry('logs', 0, true, 1),
      dirEntry('start.sh', 486, false, 4),
    ],
    '/opt/app/config': [dirEntry('application.yml', 3120, false, 2)],
    '/opt/app/logs': [dirEntry('app-20261028.log', 1_284_000, false, 1)],
    '/opt/backup': [dirEntry('app-20261027.tar.gz', 42_800_000, false, 2)],
    '/var': [dirEntry('log', 0, true, 1)],
    '/var/log': [dirEntry('messages', 96_000, false, 1)],
  }
}

function demoLocalDirs(): Record<string, RemoteEntry[]> {
  return {
    'C:\\Users\\CaiJianling\\Desktop': [
      dirEntry('运维记录', 0, true, 2),
      dirEntry('服务器清单.xlsx', 18_400, false, 5),
      dirEntry('上线检查表.md', 2_260, false, 1),
    ],
    'C:\\Users\\CaiJianling\\Desktop\\运维记录': [
      dirEntry('2026-10-备份说明.txt', 980, false, 3),
    ],
    'C:\\Users\\CaiJianling\\Documents': [dirEntry('演示文稿', 0, true, 8)],
    'C:\\Users\\CaiJianling\\Documents\\演示文稿': [],
    'C:\\Users\\CaiJianling\\Downloads': [dirEntry('MedSafeVault-2.0.0.zip', 31_200_000, false, 6)],
  }
}

const DEMO_LOCAL_ROOTS = [
  { name: 'C:', path: 'C:\\' },
  { name: 'D:', path: 'D:\\' },
]

function parentPath(path: string): string {
  if (!path) return ''
  const normalized = path.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  if (index <= 0) return normalized.slice(0, index + 1)
  return normalized.slice(0, index)
}

function takeSession(sessionId: string): MockSession {
  const session = mockSessions.find((item) => item.id === sessionId)
  if (!session) throw new Error('终端会话已关闭')
  return session
}

function mockListing(session: MockSession, path: string): RemoteListing {
  const target = path || '/'
  const entries = session.dirs[target]
  if (!entries) throw new Error('无法打开目录')
  return { path: target, entries: [...entries].sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name)) }
}

function localListing(path: string): LocalListing {
  const dirs = demoLocalDirs()
  if (!path) {
    return { path: '', parent: '', roots: DEMO_LOCAL_ROOTS, entries: [] }
  }
  const entries = dirs[path]
  if (!entries) throw new Error('无法打开目录')
  return {
    path,
    parent: parentPath(path),
    entries: [...entries].sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name)),
  }
}

let pages: MockPage[] = [  {
    id: 1,
    name: '服务器',
    icon: 'server',
    description: '物理机、虚拟机与云主机，含带外管理入口',
    sort_order: 0,
    created_at: '2025-11-03 09:20:14',
    updated_at: '2026-10-27 16:42:09',
    deleted_at: null,
    columns: serverColumns(),
    _base: serverColumns(),
  },
  {
    id: 2,
    name: '网络设备',
    icon: 'network',
    description: '核心交换、边界安全与无线网络',
    sort_order: 1,
    created_at: '2025-11-03 09:21:02',
    updated_at: '2026-10-26 10:15:44',
    deleted_at: null,
    columns: networkColumns(),
    _base: networkColumns(),
  },
  {
    id: 3,
    name: '应用系统',
    icon: 'app',
    description: '院内业务系统与对公服务账号',
    sort_order: 2,
    created_at: '2025-11-03 09:21:40',
    updated_at: '2026-10-28 08:06:11',
    deleted_at: null,
    columns: appColumns(),
    _base: appColumns(),
  },
  {
    id: 4,
    name: '数据库',
    icon: 'database',
    description: 'HIS、PACS 与报表库连接凭据',
    sort_order: 3,
    created_at: '2025-11-03 09:22:18',
    updated_at: '2026-10-25 14:31:27',
    deleted_at: null,
    columns: databaseColumns(),
    _base: databaseColumns(),
  },
]

let recordSeq = 1
const makeRecord = (
  pageId: number,
  data: Record<string, string>,
  created = '2026-09-12 10:00:00',
  updated = created,
): MockRecord => ({
  id: recordSeq++,
  page_id: pageId,
  data,
  created_at: created,
  updated_at: updated,
  deleted_at: null,
})

let records: MockRecord[] = [
  makeRecord(1, {
    type: '虚拟机',
    address: '203.0.113.172',
    app: 'HIS 数据库主库',
    os: 'Windows Server 2016 · Caché 2018',
    username: 'demo_app',
    password: 'Demo#15-PLACEHOLDER',
    port: '1972',
    oob: '192.0.2.172',
    oob_user: 'demo_oob',
    oob_pass: 'Demo#20-PLACEHOLDER',
    note: '核心业务库，变更需信息科主任审批。每日 02:00 全量备份。',
  }, '2025-11-03 10:04:12', '2026-10-27 16:42:09'),
  makeRecord(1, {
    type: '虚拟机',
    address: '203.0.113.181',
    app: 'PACS 影像服务器',
    os: 'Windows Server 2019',
    username: 'demo_pacs',
    password: 'Demo#29-PLACEHOLDER',
    port: '3389',
    oob: '192.0.2.181',
    oob_user: 'demo_oob',
    oob_pass: 'Demo#22-PLACEHOLDER',
    note: '影像归档，存储约 14 TB。',
  }, '2025-11-03 10:12:45', '2026-10-24 11:20:03'),
  makeRecord(1, {
    type: '物理机',
    address: '203.0.113.186',
    app: '门急诊应用服务器',
    os: 'CentOS 7.9',
    username: 'demo_med',
    password: 'Demo#07-PLACEHOLDER',
    port: '22',
    oob: '192.0.2.186',
    oob_user: 'demo_admin',
    oob_pass: 'Demo#27-PLACEHOLDER',
    note: '门诊叫号与分诊服务，双机热备。',
  }, '2025-11-04 08:35:11', '2026-10-28 08:06:11'),
  makeRecord(1, {
    type: '物理机',
    address: '203.0.113.190',
    app: '医保前置机',
    os: 'Windows Server 2012 R2',
    username: 'demo_yb',
    password: 'Demo#41-PLACEHOLDER',
    port: '3389',
    oob: '192.0.2.190',
    oob_user: 'demo_oob',
    oob_pass: 'Demo#23-PLACEHOLDER',
    note: '医保专网，禁止接入互联网。',
  }, '2025-11-06 14:02:30', '2026-10-21 09:44:18'),
  makeRecord(1, {
    type: '虚拟机',
    address: '203.0.113.201',
    app: '备份服务器',
    os: 'Windows Server 2019',
    username: 'demo_backup',
    password: 'Demo#05-PLACEHOLDER',
    port: '3389',
    oob: '192.0.2.201',
    oob_user: 'demo_oob',
    oob_pass: 'Demo#21-PLACEHOLDER',
    note: 'Veeam 备份，保留 30 天。',
  }, '2025-11-08 09:10:00', '2026-10-22 17:01:45'),
  makeRecord(1, {
    type: '物理机',
    address: '203.0.113.210',
    app: '虚拟化宿主机 01',
    os: 'VMware ESXi 7.0',
    username: 'demo_root',
    password: 'Demo#09-PLACEHOLDER',
    port: '22',
    oob: '192.0.2.210',
    oob_user: 'demo_root',
    oob_pass: 'Demo#24-PLACEHOLDER',
    note: '承载 HIS 测试与报表虚拟机。',
  }, '2025-11-10 15:20:08', '2026-10-20 10:33:12'),
  makeRecord(1, {
    type: '物理机',
    address: '203.0.113.215',
    app: '虚拟化宿主机 02',
    os: 'VMware ESXi 7.0',
    username: 'demo_root',
    password: 'Demo#10-PLACEHOLDER',
    port: '22',
    oob: '192.0.2.215',
    oob_user: 'demo_root',
    oob_pass: 'Demo#25-PLACEHOLDER',
    note: '承载 PACS 与接口虚拟机。',
  }, '2025-11-10 15:28:40', '2026-10-19 16:12:09'),
  makeRecord(1, {
    type: '虚拟机',
    address: '203.0.113.220',
    app: '域控服务器',
    os: 'Windows Server 2019',
    username: 'demo_ldap',
    password: 'Demo#01-PLACEHOLDER',
    port: '389',
    oob: '',
    oob_user: '',
    oob_pass: '',
    note: '主域控，备用域控 203.0.113.221。',
  }, '2025-12-01 11:42:19', '2026-10-18 09:23:55'),
  makeRecord(1, {
    type: '虚拟机',
    address: '203.0.113.230',
    app: '文件服务器',
    os: 'Windows Server 2016',
    username: 'demo_file',
    password: 'Demo#12-PLACEHOLDER',
    port: '445',
    oob: '',
    oob_user: '',
    oob_pass: '',
    note: '共享目录 \\\\203.0.113.230\\科室资料。',
  }, '2025-12-02 10:18:21', '2026-10-17 13:08:36'),
  makeRecord(1, {
    type: '虚拟机',
    address: '203.0.113.240',
    app: '接口服务器',
    os: 'CentOS 7.9',
    username: 'demo_iface',
    password: 'Demo#03-PLACEHOLDER',
    port: '8080',
    oob: '',
    oob_user: '',
    oob_pass: '',
    note: 'HIS 与医保、LIS 的接口转发。',
  }, '2025-12-05 16:30:00', '2026-10-15 15:20:00'),
  makeRecord(1, {
    type: '物理机',
    address: '203.0.113.250',
    app: '运维跳板机',
    os: 'CentOS 8.5',
    username: 'demo_jump',
    password: 'Demo#17-PLACEHOLDER',
    port: '22',
    oob: '192.0.2.250',
    oob_user: 'demo_admin',
    oob_pass: 'Demo#26-PLACEHOLDER',
    note: '所有生产运维登录必须经跳板机审计。',
  }, '2026-01-12 09:05:44', '2026-10-27 18:40:12'),

  makeRecord(2, {
    type: '交换机',
    address: '203.0.113.2',
    app: '核心交换机',
    os: '华为 S12700E',
    username: 'demo_net',
    password: 'Demo#06-PLACEHOLDER',
    port: '22',
    note: '双主控，堆叠组 s12700-stack。',
  }, '2025-11-03 11:20:00', '2026-10-26 10:15:44'),
  makeRecord(2, {
    type: '交换机',
    address: '203.0.113.3',
    app: '汇聚交换机',
    os: '华为 S5735-L',
    username: 'demo_net',
    password: 'Demo#02-PLACEHOLDER',
    port: '22',
    note: '门诊楼与住院楼各一台。',
  }, '2025-11-03 11:28:00', '2026-10-20 14:00:11'),
  makeRecord(2, {
    type: '防火墙',
    address: '203.0.113.1',
    app: '出口防火墙',
    os: '华为 USG6555E',
    username: 'demo_admin',
    password: 'Demo#13-PLACEHOLDER',
    port: '8443',
    note: '双机热备，策略变更走 OA 审批。',
  }, '2025-11-03 11:35:00', '2026-10-25 09:31:52'),
  makeRecord(2, {
    type: '路由器',
    address: '203.0.113.5',
    app: '医保专线路由器',
    os: 'H3C MSR 3620',
    username: 'demo_ybnet',
    password: 'Demo#43-PLACEHOLDER',
    port: '22',
    note: '医保专线，仅允许前置机访问。',
  }, '2025-11-05 15:10:00', '2026-10-18 16:22:07'),
  makeRecord(2, {
    type: '无线控制器',
    address: '203.0.113.8',
    app: '无线控制器',
    os: '华为 AC6605',
    username: 'demo_wlan',
    password: 'Demo#39-PLACEHOLDER',
    port: '22',
    note: '院内 AP 统一管理，访客网络独立。',
  }, '2025-11-07 10:05:00', '2026-10-12 11:40:00'),
  makeRecord(2, {
    type: '防火墙',
    address: '203.0.113.9',
    app: 'VPN 网关',
    os: '深信服 SSL VPN',
    username: 'demo_vpn',
    password: 'Demo#37-PLACEHOLDER',
    port: '4430',
    note: '仅限运维与远程会诊账号。',
  }, '2025-11-09 09:42:00', '2026-10-11 15:05:30'),
  makeRecord(2, {
    type: '负载均衡',
    address: '203.0.113.12',
    app: '应用负载均衡',
    os: 'F5 BIG-IP 15.1',
    username: 'demo_admin',
    password: 'Demo#11-PLACEHOLDER',
    port: '443',
    note: 'HIS 门户与 OA 的虚拟服务。',
  }, '2025-12-11 13:20:00', '2026-10-09 10:20:15'),

  makeRecord(3, {
    app: '电子病历系统',
    address: 'http://emr.hospital.local',
    username: 'demo_emr',
    password: 'Demo#08-PLACEHOLDER',
    note: '住院电子病历，厂商远程维护需工单。',
  }, '2025-11-04 09:10:00', '2026-10-28 08:06:11'),
  makeRecord(3, {
    app: 'OA 办公系统',
    address: 'http://oa.hospital.local',
    username: 'demo_oa',
    password: 'Demo#19-PLACEHOLDER',
    note: '全院行政办公，含审批流。',
  }, '2025-11-04 09:18:00', '2026-10-27 09:12:40'),
  makeRecord(3, {
    app: 'LIS 检验系统',
    address: 'http://lis.hospital.local:8080',
    username: 'demo_lis',
    password: 'Demo#18-PLACEHOLDER',
    note: '检验条码与仪器接口。',
  }, '2025-11-04 09:25:00', '2026-10-26 13:50:02'),
  makeRecord(3, {
    app: '门诊叫号系统',
    address: 'http://queue.hospital.local',
    username: 'demo_queue',
    password: 'Demo#31-PLACEHOLDER',
    note: '分诊叫号大屏，门诊楼 1-4 层。',
  }, '2025-11-06 10:40:00', '2026-10-24 08:30:19'),
  makeRecord(3, {
    app: '体检系统',
    address: 'http://peis.hospital.local',
    username: 'demo_peis',
    password: 'Demo#30-PLACEHOLDER',
    note: '体检登记、总检与报告。',
  }, '2025-11-08 14:12:00', '2026-10-22 16:06:55'),
  makeRecord(3, {
    app: '医院官网',
    address: 'https://www.hospital.local',
    username: 'demo_web',
    password: 'Demo#38-PLACEHOLDER',
    note: '对外网站，托管在 DMZ 区。',
  }, '2025-11-12 11:30:00', '2026-10-21 10:41:12'),
  makeRecord(3, {
    app: '微信公众号',
    address: 'https://mp.weixin.qq.com',
    username: 'demo_wx',
    password: 'Demo#40-PLACEHOLDER',
    note: '预约挂号与报告查询，管理员扫码登录。',
  }, '2025-11-15 15:00:00', '2026-10-19 09:18:00'),
  makeRecord(3, {
    app: '资产管理系统',
    address: 'http://asset.hospital.local',
    username: 'demo_asset',
    password: 'Demo#04-PLACEHOLDER',
    note: '设备科固定资产台账。',
  }, '2025-12-08 09:30:00', '2026-10-14 14:22:31'),

  makeRecord(4, {
    app: 'HIS 主库',
    address: '203.0.113.172',
    port: '1972',
    username: 'demo_app',
    password: 'Demo#15-PLACEHOLDER',
    note: 'Caché 2018，命名空间 DHC-APP。',
  }, '2025-11-03 10:10:00', '2026-10-27 16:42:09'),
  makeRecord(4, {
    app: 'PACS 归档库',
    address: '203.0.113.181',
    port: '5432',
    username: 'demo_pacsdb',
    password: 'Demo#28-PLACEHOLDER',
    note: 'PostgreSQL 14，影像索引与元数据。',
  }, '2025-11-05 10:20:00', '2026-10-24 11:21:00'),
  makeRecord(4, {
    app: '报表查询库',
    address: '203.0.113.195',
    port: '1433',
    username: 'demo_report',
    password: 'Demo#32-PLACEHOLDER',
    note: '只读账号，供绩效与运营报表使用。',
  }, '2025-11-07 09:40:00', '2026-10-23 15:10:44'),
  makeRecord(4, {
    app: '医保接口库',
    address: '203.0.113.190',
    port: '1521',
    username: 'demo_ybif',
    password: 'Demo#42-PLACEHOLDER',
    note: 'Oracle 11g，医保结算中间表。',
  }, '2025-11-09 10:05:00', '2026-10-20 08:44:19'),
  makeRecord(4, {
    app: '备份验证库',
    address: '203.0.113.205',
    port: '5432',
    username: 'demo_restore',
    password: 'Demo#33-PLACEHOLDER',
    note: '每月从备份恢复验证，验证后清空。',
  }, '2026-01-20 15:30:00', '2026-10-10 17:22:08'),
]

const recyclePage = {
  id: 5,
  name: '测试环境',
  icon: 'terminal',
  description: '已下线的测试服务器与临时账号',
  sort_order: 9,
  created_at: '2026-03-02 09:00:00',
  updated_at: '2026-09-30 17:20:00',
  deleted_at: '2026-10-08 14:22:10',
  columns: serverColumns(),
  _base: serverColumns(),
  record_count: 0,
} as MockPage

let deletedPages: Page[] = [recyclePage]

records.push(
  {
    id: 9001,
    page_id: 1,
    data: {
      type: '虚拟机',
      address: '203.0.113.21',
      app: '旧版 LIS 测试机',
      os: 'CentOS 6.10',
      username: 'demo_lis_t',
      password: 'Demo#36-PLACEHOLDER',
      port: '22',
      oob: '',
      oob_user: '',
      oob_pass: '',
      note: '已停用，等待磁盘销毁。',
    },
    created_at: '2024-08-11 09:00:00',
    updated_at: '2026-09-30 16:00:00',
    deleted_at: '2026-09-30 17:20:00',
  },
  {
    id: 9002,
    page_id: 2,
    data: {
      type: '防火墙',
      address: '203.0.113.1',
      app: '测试区防火墙',
      os: '华为 USG6000V',
      username: 'demo_admin',
      password: 'Demo#35-PLACEHOLDER',
      port: '8443',
      note: '测试环境专用。',
    },
    created_at: '2024-09-02 10:00:00',
    updated_at: '2026-09-28 11:00:00',
    deleted_at: '2026-10-05 09:12:44',
  },
  {
    id: 9003,
    page_id: 3,
    data: {
      app: '临时数据上报账号',
      address: 'http://report-test.hospital.local',
      username: 'demo_tmp',
      password: 'Demo#34-PLACEHOLDER',
      note: '卫健局临时上报，任务结束后删除。',
    },
    created_at: '2026-07-01 09:30:00',
    updated_at: '2026-09-20 10:00:00',
    deleted_at: '2026-10-11 15:40:00',
  },
)

const mkChange = (
  label: string,
  before: string,
  after: string,
  key = label,
  masked = false,
) => ({
  key,
  label,
  masked,
  before,
  after,
  has_before: before !== '',
  has_after: after !== '',
  secret: masked,
})

interface HistorySeed {
  action: string
  entity: 'record' | 'page'
  entity_id: number | null
  page_id: number | null
  page_name: string
  title: string
  minutes: number
  changes: ReturnType<typeof mkChange>[]
  raw_before?: Record<string, string>
  raw_after?: Record<string, string>
  state?: number
  undoable?: boolean
}

const historySeeds: HistorySeed[] = [
  {
    action: 'update_record',
    entity: 'record',
    entity_id: 1,
    page_id: 1,
    page_name: '服务器',
    title: '修改记录「HIS 数据库主库」',
    minutes: 8,
    changes: [
      mkChange('密码', MASK, MASK, 'password', true),
      mkChange('备注', '核心业务库，变更需审批。', '核心业务库，变更需信息科主任审批。每日 02:00 全量备份。', 'note'),
    ],
    raw_before: { password: 'Demo#16-PLACEHOLDER' },
    raw_after: { password: 'Demo#15-PLACEHOLDER' },
  },
  {
    action: 'create_record',
    entity: 'record',
    entity_id: 11,
    page_id: 1,
    page_name: '服务器',
    title: '新增记录「运维跳板机」',
    minutes: 26,
    changes: [
      mkChange('服务器地址', '', '203.0.113.250', 'address'),
      mkChange('用户名', '', 'jump', 'username'),
      mkChange('密码', '', MASK, 'password', true),
    ],
    raw_after: { password: 'Demo#17-PLACEHOLDER' },
  },
  {
    action: 'update_page',
    entity: 'page',
    entity_id: 2,
    page_id: 2,
    page_name: '网络设备',
    title: '修改页面「网络设备」',
    minutes: 94,
    changes: [
      mkChange('列配置', '7 列：设备类型、管理地址、设备名称、品牌型号、用户名、密码、端口', '8 列：设备类型、管理地址、设备名称、品牌型号、用户名、密码、端口、备注', 'columns'),
    ],
  },
  {
    action: 'update_record',
    entity: 'record',
    entity_id: 14,
    page_id: 2,
    page_name: '网络设备',
    title: '修改记录「出口防火墙」',
    minutes: 183,
    changes: [
      mkChange('密码', MASK, MASK, 'password', true),
      mkChange('端口', '443', '8443', 'port'),
    ],
    raw_before: { password: 'Demo#14-PLACEHOLDER' },
    raw_after: { password: 'Demo#13-PLACEHOLDER' },
  },
  {
    action: 'delete_record',
    entity: 'record',
    entity_id: 9002,
    page_id: 2,
    page_name: '网络设备',
    title: '删除记录「测试区防火墙」',
    minutes: 1420,
    changes: [
      mkChange('状态', '使用中', '回收站', 'status'),
      mkChange('管理地址', '203.0.113.1', '', 'address'),
      mkChange('设备名称', '测试区防火墙', '', 'app'),
      mkChange('密码', MASK, '', 'password', true),
    ],
    raw_before: { password: 'Demo#35-PLACEHOLDER' },
  },
  {
    action: 'update_record',
    entity: 'record',
    entity_id: 21,
    page_id: 3,
    page_name: '应用系统',
    title: '修改记录「电子病历系统」',
    minutes: 1560,
    changes: [
      mkChange('访问地址', 'http://emr.hospital.local:8080', 'http://emr.hospital.local', 'address'),
      mkChange('备注', '住院电子病历。', '住院电子病历，厂商远程维护需工单。', 'note'),
    ],
  },
  {
    action: 'restore_record',
    entity: 'record',
    entity_id: 9003,
    page_id: 3,
    page_name: '应用系统',
    title: '恢复记录「临时数据上报账号」',
    minutes: 2880,
    changes: [
      mkChange('状态', '回收站', '使用中', 'status'),
      mkChange('系统名称', '', '临时数据上报账号', 'app'),
    ],
  },
  {
    action: 'update_page',
    entity: 'page',
    entity_id: 1,
    page_id: 1,
    page_name: '服务器',
    title: '修改页面「服务器」',
    minutes: 4300,
    changes: [
      mkChange('描述', '物理机与虚拟机', '物理机、虚拟机与云主机，含带外管理入口', 'description'),
    ],
  },
  {
    action: 'import_records',
    entity: 'record',
    entity_id: null,
    page_id: 3,
    page_name: '应用系统',
    title: '从 Excel 导入 6 条记录到「应用系统」',
    minutes: 5800,
    changes: [mkChange('导入记录', '', '6 条记录', 'import')],
  },
  {
    action: 'delete_page',
    entity: 'page',
    entity_id: 5,
    page_id: 5,
    page_name: '测试环境',
    title: '删除页面「测试环境」',
    minutes: 8340,
    changes: [mkChange('状态', '使用中', '回收站', 'status')],
  },
]

let history: InternalHistory[] = historySeeds
  .map((seed, index) => ({
    id: historySeeds.length - index,
    action: seed.action,
    entity: seed.entity,
    entity_id: seed.entity_id,
    page_id: seed.page_id,
    page_name: seed.page_name,
    title: seed.title,
    created_at: ago(seed.minutes),
    state: seed.state ?? 0,
    undoable: seed.undoable ?? !['delete_record', 'restore_record', 'delete_page'].includes(seed.action),
    can_undo: false,
    changes: seed.changes,
    raw_before: seed.raw_before ?? {},
    raw_after: seed.raw_after ?? {},
  }))
  .sort((a, b) => b.id - a.id)

// The newest undoable entry drives the header buttons.
const firstUndoable = history.find((item) => item.state === 0 && item.undoable)
if (firstUndoable) {
  firstUndoable.state = 0
}

const MUTATING_ACTIONS = new Set([
  'create_record',
  'update_record',
  'delete_record',
  'restore_record',
  'create_page',
  'update_page',
  'delete_page',
  'restore_page',
  'import_records',
])

function undoState(): UndoState {
  const undo = history.find((item) => item.state === 0 && item.undoable)
  const redo = [...history].reverse().find((item) => item.state === 1)
  return {
    can_undo: Boolean(undo),
    can_redo: Boolean(redo),
    undo: undo ? { id: undo.id, title: undo.title } : null,
    redo: redo ? { id: redo.id, title: redo.title } : null,
  }
}

function pushHistory(
  action: string,
  entity: 'record' | 'page',
  entityId: number | null,
  pageId: number | null,
  title: string,
  changes: ReturnType<typeof mkChange>[] = [],
  rawBefore: Record<string, string> = {},
  rawAfter: Record<string, string> = {},
) {
  history = history.map((item) => (item.state === 1 ? { ...item, state: 2 } : item))
  const nextId = Math.max(0, ...history.map((item) => item.id)) + 1
  history.unshift({
    id: nextId,
    action,
    entity,
    entity_id: entityId,
    page_id: pageId,
    page_name: pageName(pageId),
    title,
    created_at: ISO(new Date()),
    state: 0,
    undoable: MUTATING_ACTIONS.has(action),
    can_undo: false,
    changes,
    raw_before: rawBefore,
    raw_after: rawAfter,
  })
}

function pageName(pageId: number | null): string {
  if (pageId == null) return ''
  return pages.find((p) => p.id === pageId)?.name ?? '已删除页面'
}

function activePages(): Page[] {
  return pages
    .filter((page) => !page.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((page) => {
      const columns = publicColumns(page)
      return {
        ...page,
        columns,
        hidden_columns: columns.filter((c) => !c.visible).length,
        record_count: records.filter((r) => r.page_id === page.id && !r.deleted_at).length,
      }
    })
}

function publicColumns(page: MockPage): Column[] {
  return page._base.map((column) => {
    let masked = column.masked
    if (settings.mask_usernames && ['username', 'oob_user'].includes(column.key)) masked = true
    if (settings.mask_addresses && ['address', 'oob'].includes(column.key)) masked = true
    return {
      ...column,
      masked,
      encrypted: true,
      secret: column.type === 'password',
    }
  })
}

function pageById(pageId: number): MockPage | undefined {
  return pages.find((p) => p.id === pageId)
}

function demoExcelPreview(page: MockPage, path = DEMO_EXCEL_FILE): ExcelPreview {
  const visible = publicColumns(page).filter((column) => column.visible)
  const rowCount = 6
  return {
    headers: visible.map((column) => column.label),
    mapped: visible.map((column) => ({
      key: column.key,
      label: column.label,
      header: column.label,
    })),
    unmatched: [],
    rows: rowCount,
    samples: Array.from({ length: rowCount }, (_, index) =>
      Object.fromEntries(
        visible.map((column) => [
          column.key,
          column.masked
            ? MASK
            : index === 3
              ? '—'
              : `示例${column.label}${index + 1}`,
        ]),
      ),
    ),
    preview_limit: 300,
    selectable: true,
    path,
    page_id: page.id,
  }
}

function titleFor(record: MockRecord, columns: Column[]): string {
  for (const key of ['app', 'name', 'title', 'address', 'host']) {
    if (record.data[key]) return record.data[key]
  }
  for (const column of columns) {
    if (column.masked) continue
    if (record.data[column.key]) return record.data[column.key]
  }
  return '未命名记录'
}

function presentRecord(record: MockRecord, page: MockPage) {
  const columns = publicColumns(page).filter((c) => c.visible)
  const cells: RecordList['rows'][number]['cells'] = {}
  for (const column of columns) {
    const value = record.data[column.key] ?? ''
    cells[column.key] = column.masked
      ? { value: value ? MASK : '', masked: true, has: Boolean(value) }
      : { value, masked: false, has: Boolean(value) }
  }
  return {
    id: record.id,
    page_id: record.page_id,
    title: titleFor(record, columns),
    cells,
    created_at: record.created_at,
    updated_at: record.updated_at,
    deleted_at: record.deleted_at,
  }
}

function listHistory(offset: number, limit: number, kind: string, query: string): HistoryList {
  const needle = query.trim().toLowerCase()
  const filtered = history.filter((item) => {
    if (kind !== 'all' && item.entity !== kind) return false
    if (needle && !`${item.title} ${item.page_name}`.toLowerCase().includes(needle)) return false
    return true
  })
  const undo = history.find((item) => item.state === 0 && item.undoable)
  return {
    items: filtered.slice(offset, offset + limit).map((item) => ({
      ...item,
      can_undo: item.id === undo?.id,
    })),
    total: filtered.length,
    undoable_id: undo?.id ?? null,
    undo_state: undoState(),
  }
}

function stateInfo(): StateInfo {
  return {
    initialized,
    locked,
    lock_reason: locked ? lockReason : null,
    auto_lock_minutes: settings.auto_lock_minutes,
    remaining_seconds: locked ? 0 : Math.max(0, settings.auto_lock_minutes * 60),
    theme: 'system',
    settings,
    recovery: {
      enabled: true,
      created_at: '2026-09-30 09:12:41',
      generation: 3,
    },
    version: '2.0.0',
    data_dir: 'C:\\Users\\CaiJianling\\AppData\\Roaming\\MedSafeVault',
    db_file: 'C:\\Users\\CaiJianling\\AppData\\Roaming\\MedSafeVault\\vault.db',
    vault_id: '8f2c1d7a4b9e6f30',
  }
}

function stats() {
  return {
    pages: pages.filter((p) => !p.deleted_at).length,
    records: records.filter((r) => !r.deleted_at && !pageById(r.page_id)?.deleted_at).length,
    secrets: pages.reduce(
      (sum, page) => sum + page._base.filter((column) => column.type === 'password').length,
      0,
    ),
    history: history.length,
    recycle_pages: deletedPages.length,
    recycle_records: records.filter((r) => r.deleted_at).length,
  }
}

function recycle(): RecycleList {
  const deletedPageItems = deletedPages.map((page) => ({
    type: 'page' as const,
    id: page.id,
    name: page.name,
    icon: page.icon,
    description: page.description,
    deleted_at: page.deleted_at || ago(60),
    record_count: records.filter((r) => r.page_id === page.id && !r.deleted_at).length,
  }))
  const deletedRecordItems = records
    .filter((record) => record.deleted_at)
    .map((record) => {
      const page = pageById(record.page_id)
      const columns = page ? publicColumns(page) : serverColumns()
      const preview = columns
        .filter((column) => !column.masked)
        .map((column) => ({ label: column.label, value: record.data[column.key] || '' }))
        .filter((item) => item.value)
        .slice(0, 3)
      return {
        type: 'record' as const,
        id: record.id,
        page_id: record.page_id,
        page_name: page?.name ?? '已删除页面',
        page_deleted: Boolean(page?.deleted_at) || !page,
        title: titleFor(record, columns),
        deleted_at: record.deleted_at || ago(60),
        preview,
      }
    })
  return {
    pages: deletedPageItems,
    records: deletedRecordItems,
    counts: { pages: deletedPageItems.length, records: deletedRecordItems.length },
  }
}

const DEMO_PASSWORD = 'Demo@Vault2026'

function requireUnlocked() {
  if (locked) throw new Error('密码库已锁定，请重新输入打开密码')
}

function normalizePagePayload(payload: Partial<Page>): {
  name: string
  icon: string
  description: string
  columns: Column[]
} {
  const name = (payload.name || '').trim()
  if (!name) throw new Error('页面名称不能为空')
  if (name.length > 24) throw new Error('页面名称不能超过 24 个字符')
  const source = payload.columns || []
  if (!source.length) throw new Error('页面至少需要一列')
  const labels = new Set<string>()
  const columns = source.map((column, index) => {
    const label = (column.label || '').trim()
    if (!label) throw new Error('列名称不能为空')
    if (labels.has(label)) throw new Error(`列名称「${label}」重复`)
    labels.add(label)
    const type = column.type || 'text'
    const key =
      column.key && /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(column.key)
        ? column.key
        : `c_${Math.random().toString(16).slice(2, 10)}`
    return {
      id: column.id,
      key,
      label,
      type,
      encrypted: Boolean(column.encrypted) || type === 'password',
      masked: Boolean(column.masked) || type === 'password',
      width: Math.max(80, Math.min(Number(column.width) || 160, 600)),
      visible: column.visible !== false,
      required: Boolean(column.required),
      options: Array.isArray(column.options) ? column.options.filter(Boolean).slice(0, 50) : [],
      placeholder: (column.placeholder || '').slice(0, 60),
      order: index,
    }
  })
  return { name, icon: payload.icon || 'grid', description: payload.description || '', columns }
}

function seedPagesFromTemplates() {
  colSeq = 1
  pages = [
    {
      id: 1,
      name: '服务器',
      icon: 'server',
      description: '物理机、虚拟机与云主机，含带外管理入口',
      sort_order: 0,
      created_at: ISO(new Date()),
      updated_at: ISO(new Date()),
      deleted_at: null,
      columns: serverColumns(),
      _base: serverColumns(),
    },
    {
      id: 2,
      name: '网络设备',
      icon: 'network',
      description: '核心交换、边界安全与无线网络',
      sort_order: 1,
      created_at: ISO(new Date()),
      updated_at: ISO(new Date()),
      deleted_at: null,
      columns: networkColumns(),
      _base: networkColumns(),
    },
    {
      id: 3,
      name: '应用系统',
      icon: 'app',
      description: '院内业务系统与对公服务账号',
      sort_order: 2,
      created_at: ISO(new Date()),
      updated_at: ISO(new Date()),
      deleted_at: null,
      columns: appColumns(),
      _base: appColumns(),
    },
    {
      id: 4,
      name: '数据库',
      icon: 'database',
      description: 'HIS、PACS 与报表库连接凭据',
      sort_order: 3,
      created_at: ISO(new Date()),
      updated_at: ISO(new Date()),
      deleted_at: null,
      columns: databaseColumns(),
      _base: databaseColumns(),
    },
  ]
  records = []
  recordSeq = 1
  deletedPages = []
  history = []
}

function recoveryInfo() {
  return {
    code: 'K7RM-4Q2P-9WXH-8TNE-3J5V-6BGY-2FDC-7QLA',
    created_at: ISO(new Date()),
    generation: stateInfo().recovery.generation + 1,
    filename: `MedSafeVault-恢复密钥-${ISO(new Date()).slice(0, 10).replace(/-/g, '')}.msvkey`,
  }
}

export async function mockCall<T>(method: string, args: unknown[]): Promise<T> {
  await sleep(method === 'get_bootstrap' ? 280 : method.includes('recovery') ? 320 : 90)
  const result = (() => {
    switch (method) {
      case 'get_bootstrap':
        return { state: stateInfo(), templates, version: '2.0.0' } satisfies Bootstrap
      case 'get_state':
        return { state: stateInfo() }
      case 'initialize': {
        if (initialized) throw new Error('密码库已经初始化')
        const password = String(args[0] || '')
        if (password.length < 8) throw new Error('打开密码至少需要 8 位')
        initialized = true
        locked = false
        lockReason = null
        seedPagesFromTemplates()
        return { state: stateInfo(), recovery: recoveryInfo() }
      }
      case 'unlock': {
        const password = String(args[0] || '')
        if (password.length < 4) throw new Error('打开密码不正确')
        locked = false
        lockReason = null
        return { state: stateInfo() }
      }
      case 'lock':
        locked = true
        lockReason = 'manual'
        return { state: stateInfo() }
      case 'heartbeat':
        return { locked, remaining_seconds: locked ? 0 : Math.max(0, settings.auto_lock_minutes * 60) }
      case 'activity':
        return { locked, remaining_seconds: locked ? 0 : Math.max(0, settings.auto_lock_minutes * 60) }
      case 'change_master_password':
        requireUnlocked()
        if (!String(args[0] || '')) throw new Error('请输入当前打开密码')
        return { ok: true }
      case 'get_recovery_status':
        return { recovery: stateInfo().recovery }
      case 'rotate_recovery':
        requireUnlocked()
        return { recovery: recoveryInfo(), status: stateInfo().recovery }
      case 'save_recovery_file':
        requireUnlocked()
        return { path: 'C:\\Users\\Public\\Desktop\\MedSafeVault-恢复密钥.msvkey' }
      case 'pick_recovery_file':
        return { path: 'C:\\Users\\Public\\Desktop\\MedSafeVault-恢复密钥.msvkey', ok: true, vault_id: '8f2c1d7a4b9e6f30' }
      case 'start_recovery_with_code': {
        const code = String(args[0] || '').replace(/[^A-Za-z0-9]/g, '')
        if (code.toUpperCase() !== 'DEMO' && code.length < 16) {
          throw new Error('恢复密钥不正确')
        }
        return { ok: true, vault_id: '8f2c1d7a4b9e6f30' }
      }
      case 'finish_recovery': {
        const password = String(args[0] || '')
        if (password.length < 8) throw new Error('打开密码至少需要 8 位')
        locked = false
        lockReason = null
        return { state: stateInfo() }
      }
      case 'cancel_recovery':
        return { ok: true }
      case 'get_templates':
        return { templates }
      case 'get_pages':
        requireUnlocked()
        return { pages: activePages() }
      case 'get_page': {
        requireUnlocked()
        const page = pageById(Number(args[0]))
        if (!page) throw new Error('页面不存在')
        return { page: { ...page, columns: publicColumns(page) } }
      }
      case 'create_page': {
        requireUnlocked()
        const payload = normalizePagePayload((args[0] || {}) as Partial<Page>)
        if (pages.some((page) => !page.deleted_at && page.name === payload.name)) {
          throw new Error('已存在同名页面')
        }
        const id = Math.max(0, ...pages.map((p) => p.id), ...deletedPages.map((p) => p.id)) + 1
        const page: MockPage = {
          id,
          name: payload.name,
          icon: payload.icon,
          description: payload.description,
          sort_order: pages.length,
          created_at: ISO(new Date()),
          updated_at: ISO(new Date()),
          deleted_at: null,
          columns: payload.columns,
          _base: payload.columns,
        }
        pages.push(page)
        pushHistory('create_page', 'page', id, id, `新建页面「${page.name}」`, [
          mkChange('页面名称', '', page.name, 'name'),
        ])
        return { page: { ...page, columns: publicColumns(page), record_count: 0 } }
      }
      case 'update_page': {
        requireUnlocked()
        const id = Number(args[0])
        const page = pageById(id)
        if (!page) throw new Error('页面不存在')
        const payload = normalizePagePayload((args[1] || {}) as Partial<Page>)
        const oldName = page.name
        page.name = payload.name
        page.icon = payload.icon
        page.description = payload.description
        page._base = payload.columns
        page.columns = payload.columns
        page.updated_at = ISO(new Date())
        pushHistory(
          'update_page',
          'page',
          id,
          id,
          oldName === page.name ? `修改页面「${page.name}」` : `修改页面「${oldName}」→「${page.name}」`,
          [
            mkChange('页面名称', oldName, page.name, 'name'),
            mkChange('列配置', '原列配置', `${payload.columns.length} 列`, 'columns'),
          ],
        )
        return { page: { ...page, columns: publicColumns(page), record_count: records.filter((r) => r.page_id === id && !r.deleted_at).length } }
      }
      case 'delete_page': {
        requireUnlocked()
        const id = Number(args[0])
        const page = pageById(id)
        if (!page) throw new Error('页面不存在')
        page.deleted_at = ISO(new Date())
        deletedPages = [...deletedPages, page]
        pushHistory('delete_page', 'page', id, id, `删除页面「${page.name}」`, [
          mkChange('状态', '使用中', '回收站', 'status'),
        ])
        return { ok: true, recycle_id: id }
      }
      case 'list_records': {
        requireUnlocked()
        const pageId = Number(args[0])
        const query = String(args[1] || '').trim().toLowerCase()
        const offset = Number(args[2] || 0)
        const limit = Number(args[3] || 50)
        const sortKey = args[4] ? String(args[4]) : null
        const sortDir = String(args[5] || 'asc')
        const page = pageById(pageId)
        if (!page) throw new Error('页面不存在')
        let rows = records.filter((record) => record.page_id === pageId && !record.deleted_at)
        if (query) {
          rows = rows.filter((record) =>
            Object.values(record.data).some((value) => String(value).toLowerCase().includes(query)),
          )
        }
        if (sortKey) {
          rows = [...rows].sort((a, b) => {
            const av = String(a.data[sortKey] || '').toLowerCase()
            const bv = String(b.data[sortKey] || '').toLowerCase()
            return av.localeCompare(bv) * (sortDir === 'desc' ? -1 : 1)
          })
        }
        const total = rows.length
        const items = rows.slice(offset, offset + limit).map((record) => presentRecord(record, page))
        return {
          page: { id: page.id, name: page.name, icon: page.icon, description: page.description },
          columns: publicColumns(page).filter((column) => column.visible),
          rows: items,
          total,
          offset,
          limit,
        } satisfies RecordList
      }
      case 'get_record': {
        requireUnlocked()
        const record = records.find((item) => item.id === Number(args[0]))
        if (!record) throw new Error('记录不存在')
        const page = pageById(record.page_id)
        if (!page) throw new Error('页面不存在')
        return {
          record: {
            id: record.id,
            page_id: record.page_id,
            page_name: page.name,
            values: { ...record.data },
            columns: publicColumns(page),
            created_at: record.created_at,
            updated_at: record.updated_at,
          } satisfies RecordDetail,
        }
      }
      case 'save_record': {
        requireUnlocked()
        const pageId = Number(args[0])
        const values = (args[1] || {}) as Record<string, string>
        const recordId = args[2] ? Number(args[2]) : null
        const page = pageById(pageId)
        if (!page) throw new Error('页面不存在')
        for (const column of page._base) {
          if (column.required && !String(values[column.key] || '').trim()) {
            throw new Error(`「${column.label}」不能为空`)
          }
        }
        if (recordId) {
          const record = records.find((item) => item.id === recordId)
          if (!record) throw new Error('记录不存在')
          const before = { ...record.data }
          record.data = { ...record.data, ...values }
          record.updated_at = ISO(new Date())
          pushHistory(
            'update_record',
            'record',
            record.id,
            pageId,
            `修改记录「${titleFor(record, page._base)}」`,
            Object.keys(values)
              .filter((key) => (before[key] ?? '') !== (values[key] ?? ''))
              .slice(0, 6)
              .map((key) => {
                const column = page._base.find((c) => c.key === key)
                const masked = Boolean(column?.masked)
                return mkChange(
                  column?.label ?? key,
                  masked && before[key] ? MASK : before[key] ?? '',
                  masked && values[key] ? MASK : values[key] ?? '',
                  key,
                  masked,
                )
              }),
            before,
            { ...record.data },
          )
          return { record: presentRecord(record, page), page_id: pageId }
        }
        const record: MockRecord = {
          id: Math.max(0, ...records.map((item) => item.id)) + 1,
          page_id: pageId,
          data: { ...values },
          created_at: ISO(new Date()),
          updated_at: ISO(new Date()),
          deleted_at: null,
        }
        records.push(record)
        pushHistory('create_record', 'record', record.id, pageId, `新增记录「${titleFor(record, page._base)}」`, [
          mkChange('名称', '', titleFor(record, page._base), 'app'),
        ])
        return { record: presentRecord(record, page), page_id: pageId }
      }
      case 'delete_record': {
        requireUnlocked()
        const record = records.find((item) => item.id === Number(args[0]))
        if (!record) throw new Error('记录不存在')
        if (record.deleted_at) throw new Error('记录已在回收站中')
        const page = pageById(record.page_id)
        record.deleted_at = ISO(new Date())
        pushHistory(
          'delete_record',
          'record',
          record.id,
          record.page_id,
          `删除记录「${page ? titleFor(record, page._base) : '未命名'}」`,
          [mkChange('状态', '使用中', '回收站', 'status')],
        )
        return { ok: true, record_id: record.id, page_id: record.page_id }
      }
      case 'reveal_secret': {
        requireUnlocked()
        const record = records.find((item) => item.id === Number(args[0]))
        if (!record) throw new Error('记录不存在')
        return { value: record.data[String(args[1])] ?? '' }
      }
      case 'generate_password': {
        const length = Math.max(8, Number(args[0] || 20))
        const symbols = Boolean(args[1])
        const alphabet = `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789${symbols ? '!@#$%^&*-_+=' : ''}`
        let value = ''
        const values = new Uint32Array(length)
        crypto.getRandomValues(values)
        for (let index = 0; index < length; index += 1) value += alphabet[values[index] % alphabet.length]
        return { value, score: passwordStrength(value).score }
      }
      case 'get_history':
        requireUnlocked()
        return listHistory(
          Number(args[0] || 0),
          Number(args[1] || 40),
          String(args[2] || 'all'),
          String(args[3] || ''),
        )
      case 'reveal_history': {
        requireUnlocked()
        const item = history.find((entry) => entry.id === Number(args[0]))
        if (!item) throw new Error('历史记录不存在')
        const side = String(args[1]) === 'before' ? item.raw_before : item.raw_after
        return { value: side[String(args[2])] ?? '' }
      }
      case 'undo': {
        requireUnlocked()
        const item = history.find((entry) => entry.state === 0 && entry.undoable)
        if (!item) throw new Error('没有可以撤回的操作')
        item.state = 1
        return { ok: true, message: `已撤回：${item.title}`, undo_state: undoState() }
      }
      case 'redo': {
        requireUnlocked()
        const item = [...history].reverse().find((entry) => entry.state === 1)
        if (!item) throw new Error('没有可以恢复的操作')
        item.state = 0
        return { ok: true, message: `已恢复：${item.title}`, undo_state: undoState() }
      }
      case 'get_recycle':
        requireUnlocked()
        return recycle()
      case 'restore_record': {
        requireUnlocked()
        const record = records.find((item) => item.id === Number(args[0]))
        if (!record || !record.deleted_at) throw new Error('记录不在回收站中')
        const page = pageById(record.page_id)
        if (!page || page.deleted_at) throw new Error('所属页面也在回收站中，请先恢复页面')
        record.deleted_at = null
        record.updated_at = ISO(new Date())
        pushHistory('restore_record', 'record', record.id, record.page_id, `恢复记录「${titleFor(record, page._base)}」`, [
          mkChange('状态', '回收站', '使用中', 'status'),
        ])
        return { ok: true }
      }
      case 'restore_page': {
        requireUnlocked()
        const id = Number(args[0])
        const page = pages.find((item) => item.id === id) || deletedPages.find((item) => item.id === id)
        if (!page || !page.deleted_at) throw new Error('页面不在回收站中')
        page.deleted_at = null
        deletedPages = deletedPages.filter((item) => item.id !== id)
        pushHistory('restore_page', 'page', id, id, `恢复页面「${page.name}」`, [
          mkChange('状态', '回收站', '使用中', 'status'),
        ])
        return { ok: true }
      }
      case 'purge_record': {
        requireUnlocked()
        const id = Number(args[0])
        records = records.filter((item) => !(item.id === id && item.deleted_at))
        return { ok: true }
      }
      case 'purge_page': {
        requireUnlocked()
        const id = Number(args[0])
        deletedPages = deletedPages.filter((item) => item.id !== id)
        pages = pages.filter((item) => !(item.id === id && item.deleted_at))
        records = records.filter((item) => item.page_id !== id)
        return { ok: true }
      }
      case 'empty_recycle': {
        requireUnlocked()
        const counts = { pages: deletedPages.length, records: records.filter((r) => r.deleted_at).length }
        if (!counts.pages && !counts.records) throw new Error('回收站已经是空的')
        const ids = new Set(deletedPages.map((page) => page.id))
        deletedPages = []
        pages = pages.filter((page) => !ids.has(page.id))
        records = records.filter((record) => !record.deleted_at && !ids.has(record.page_id))
        return { ok: true, ...counts }
      }
      case 'copy_text':
        return { ok: true }
      case 'copy_secret':
        return { seconds: 30 }
      case 'connect': {
        requireUnlocked()
        const record = records.find((item) => item.id === Number(args[0]))
        if (!record) throw new Error('记录不存在')
        const address = (record.data.address || record.data.oob || '').trim()
        if (!address) throw new Error('该记录没有可用于连接的地址')
        const requested = String(args[1] || '').trim().toLowerCase()
        if (/^https?:/i.test(address) && !requested) {
          return {
            mode: 'web',
            transport: 'browser',
            target: address,
            title: address,
            message: t('已用默认浏览器打开 {target}', { target: address }),
          }
        }
        let mode = requested && requested !== 'auto' ? requested : record.data.connect_mode || 'auto'
        if (mode === 'auto') {
          const port = Number(address.split(':').pop())
          if ([5900, 5901, 5902, 5903].includes(port)) mode = 'vnc'
          else if (port === 3389) mode = 'rdp'
          else if (port === 21) mode = 'ftp'
          else if (port === 23) mode = 'telnet'
          else if (port === 22) mode = 'ssh'
          else if (/windows/i.test(record.data.os || '')) mode = 'rdp'
          else mode = 'ssh'
        }
        const username = record.data.username || ''
        const password = record.data.password || ''
        const sshClient =
          settings.ssh_client === 'auto'
            ? settings.securecrt_path
              ? 'securecrt'
              : 'builtin'
            : settings.ssh_client
        if (mode === 'ssh' && sshClient === 'builtin') {
          const id = `mock-ssh-${mockSessionSeq++}`
          const prompt = `\u001b[32m${username || 'demo'}@demo-${address.split(':')[0]}\u001b[0m:\u001b[34m~\u001b[0m$ `
          mockSessions.push({
            id,
            kind: 'ssh',
            protocol: 'SSH',
            title: address,
            target: address,
            username,
            password,
            buffer:
              '\u001b[36mMedSafeVault 演示终端\u001b[0m — 以下内容为虚构示例\r\n' +
              `Last login: ${ISO(new Date())} from 198.51.100.10\r\n` +
              `\u001b[33m演示模式：命令不会真正执行。\u001b[0m\r\n${prompt}`,
            pending: '',
            dirs: {},
            closed: false,
          })
          return {
            mode,
            transport: 'builtin',
            kind: 'ssh',
            protocol: 'SSH',
            session_id: id,
            target: address,
            title: address,
            message: t('已在内置终端中打开 {target}', { target: address }),
          }
        }
        if ((mode === 'ftp' || mode === 'sftp') && settings.file_client === 'builtin') {
          const id = `mock-files-${mockSessionSeq++}`
          const protocol = mode === 'ftp' ? 'FTP' : 'SFTP'
          mockSessions.push({
            id,
            kind: 'files',
            protocol,
            title: `${protocol} · ${address}`,
            target: address,
            username,
            password,
            buffer: '',
            pending: '',
            dirs: demoDirs(protocol),
            closed: false,
          })
          return {
            mode,
            transport: 'builtin',
            kind: 'files',
            protocol,
            session_id: id,
            target: address,
            title: `${protocol} · ${address}`,
            message: t('已在内置文件管理中打开 {target}', { target: address }),
          }
        }
        if (mode === 'rdp') {
          const pid = 3000 + mockSessionSeq++
          return {
            mode,
            transport: 'window',
            target: address,
            title: address,
            pid,
            message: t('已启动远程桌面窗口：{target}', { target: address }),
          }
        }
        const label =
          mode === 'vnc'
            ? 'VNC Viewer'
            : mode === 'ftp' || mode === 'sftp'
              ? 'WinSCP'
              : mode === 'telnet'
                ? 'Telnet'
                : 'SecureCRT'
        return {
          mode,
          transport: 'external',
          target: address,
          title: address,
          message: t('已启动 {program}：{target}', { program: label, target: address }),
        }
      }
      case 'terminal_list':
        return {
          sessions: mockSessions
            .filter((session) => !session.closed)
            .map(({ id, kind, protocol, title }) => ({ id, kind, protocol, title, error: '' })),
        }
      case 'terminal_read': {
        requireUnlocked()
        const session = takeSession(String(args[0]))
        const cursor = Math.max(0, Number(args[1]) || 0)
        if (session.kind !== 'ssh') return { data: '', cursor, closed: false, error: '' }
        const data = session.buffer.slice(cursor)
        return { data, cursor: session.buffer.length, closed: session.closed, error: '' }
      }
      case 'terminal_write': {
        requireUnlocked()
        const session = takeSession(String(args[0]))
        if (session.kind !== 'ssh' || session.closed) return { ok: true }
        const prompt = `\u001b[32m${session.username || 'demo'}@demo-${session.target.split(':')[0]}\u001b[0m:\u001b[34m~\u001b[0m$ `
        for (const char of String(args[1] || '')) {
          if (char === '\r' || char === '\n') {
            session.buffer += `\r\n${prompt}`
            session.pending = ''
          } else if (char === '\u007f') {
            if (session.pending) {
              session.pending = session.pending.slice(0, -1)
              session.buffer += '\b \b'
            }
          } else if (char === '\u0003') {
            session.buffer += `^C\r\n${prompt}`
            session.pending = ''
          } else if (char >= ' ') {
            session.pending += char
            session.buffer += char
          }
        }
        return { ok: true }
      }
      case 'terminal_resize':
        return { ok: true }
      case 'session_close': {
        const session = mockSessions.find((item) => item.id === String(args[0]))
        if (session) session.closed = true
        mockSessions = mockSessions.filter((item) => !item.closed)
        return { ok: true }
      }
      case 'files_list':
        return mockListing(takeSession(String(args[0])), String(args[1] || ''))
      case 'files_mkdir': {
        const session = takeSession(String(args[0]))
        const path = String(args[1] || '')
        const parent = parentPath(path)
        const name = path.slice(parent.length).replace(/^[\\/]+/, '')
        if (!session.dirs[parent]) throw new Error('无法新建文件夹')
        session.dirs[parent].push(dirEntry(name, 0, true, 0))
        session.dirs[path] = []
        return { ok: true }
      }
      case 'files_remove': {
        const session = takeSession(String(args[0]))
        const path = String(args[1] || '')
        const parent = parentPath(path)
        const name = path.slice(parent.length).replace(/^[\\/]+/, '')
        session.dirs[parent] = (session.dirs[parent] || []).filter((entry) => entry.name !== name)
        delete session.dirs[path]
        return { ok: true }
      }
      case 'files_rename': {
        const session = takeSession(String(args[0]))
        const oldPath = String(args[1] || '')
        const newPath = String(args[2] || '')
        const parent = parentPath(oldPath)
        const oldName = oldPath.slice(parent.length).replace(/^[\\/]+/, '')
        const newName = newPath.slice(parentPath(newPath).length).replace(/^[\\/]+/, '')
        const entry = (session.dirs[parent] || []).find((item) => item.name === oldName)
        if (!entry) throw new Error('文件不存在')
        entry.name = newName
        if (session.dirs[oldPath]) {
          session.dirs[newPath] = session.dirs[oldPath]
          delete session.dirs[oldPath]
        }
        return { ok: true }
      }
      case 'files_download':
        return {
          saved: `C:\\Users\\CaiJianling\\Downloads\\${String(args[1] || '').split(/[\\/]/).pop() || 'demo.bin'}`,
          name: String(args[1] || '').split(/[\\/]/).pop() || 'demo.bin',
        }
      case 'files_upload':
        return { uploaded: String(args[1] || ''), name: '上传示例.txt' }
      case 'local_list':
        return { listing: localListing(String(args[0] || '')) }
      case 'rdp_focus':
        return { focused: true }
      case 'rdp_close':
        return { closed: true }
      case 'choose_program': {
        const paths: Record<string, string> = {
          securecrt_path: 'C:\\Program Files\\VanDyke Software\\Clients\\SecureCRT.exe',
          putty_path: 'C:\\Program Files\\PuTTY\\putty.exe',
          xshell_path: 'C:\\Program Files\\NetSarang\\Xshell\\Xshell.exe',
          winscp_path: 'C:\\Program Files\\WinSCP\\WinSCP.exe',
          vnc_viewer_path: 'C:\\Program Files\\RealVNC\\VNC Viewer\\vncviewer.exe',
        }
        const key = String(args[0] || '')
        const path = paths[key]
        if (!path) throw new Error('不支持的程序类型')
        settings = { ...settings, [key]: path } as Settings
        return { settings, path }
      }
      case 'close_window':
        return { ok: true, hidden: String(args[0] || '') !== 'quit' }
      case 'dismiss_close_prompt':
        return { ok: true }
      case 'preview_excel': {
        requireUnlocked()
        const page = pageById(Number(args[0]))
        if (!page) throw new Error('页面不存在')
        if (demoExcelLocked) return { locked: true, path: DEMO_EXCEL_LOCKED_FILE }
        return { preview: demoExcelPreview(page) }
      }
      case 'preview_excel_file': {
        requireUnlocked()
        const page = pageById(Number(args[0]))
        if (!page) throw new Error('页面不存在')
        if (String(args[2] || '') !== DEMO_EXCEL_PASSWORD) {
          throw new Error('Excel 打开密码不正确')
        }
        return { preview: demoExcelPreview(page, String(args[1] || DEMO_EXCEL_LOCKED_FILE)) }
      }
      case 'import_excel': {
        requireUnlocked()
        const page = pageById(Number(args[0]))
        if (!page) throw new Error('页面不存在')
        const raw = Array.isArray(args[3]) ? (args[3] as unknown[]) : null
        const chosen = raw
          ? raw.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0)
          : [0, 1, 2]
        if (!chosen.length) throw new Error('请至少勾选一行要导入的数据')
        const stamp = ISO(new Date())
        for (const index of chosen) {
          records.push({
            id: Math.max(0, ...records.map((r) => r.id)) + 1,
            page_id: page.id,
            data: {
              address: `203.0.114.${40 + index}`,
              app: `导入示例 ${index + 1}`,
              username: 'demo_import',
              password: `Import@2026#${index + 1}`,
              note: '来自 Excel 演示导入',
            },
            created_at: stamp,
            updated_at: stamp,
            deleted_at: null,
          })
        }
        pushHistory(
          'import_records', 'record', null, page.id,
          `从 Excel 导入 ${chosen.length} 条记录到「${page.name}」`,
          [mkChange('导入记录', '', `${chosen.length} 条记录`, 'import')],
        )
        return { ok: true, count: chosen.length }
      }
      case 'export_excel': {
        requireUnlocked()
        const workbookPassword = String(args[1] || '')
        if (workbookPassword && workbookPassword.length < 8) {
          throw new Error('Excel 密码至少需要 8 位')
        }
        return {
          ok: true,
          count: records.filter((record) => record.page_id === Number(args[0]) && !record.deleted_at).length,
          path: 'C:\\Users\\CaiJianling\\Desktop\\导出结果.xlsx',
          sealed: Boolean(workbookPassword),
        }
      }
      case 'export_template':
        return { ok: true, path: 'C:\\Users\\CaiJianling\\Desktop\\导入模板.xlsx' }
      case 'export_backup': {
        const backupPassword = String(args[0] || '')
        if (backupPassword.length < 8) throw new Error('备份密码至少需要 8 位')
        return {
          path: 'C:\\Users\\CaiJianling\\Desktop\\MedSafeVault-备份.msvbackup',
          sealed: true,
        }
      }
      case 'pick_backup':
        // Demo file is sealed: nothing can be read before the password arrives.
        return {
          path: 'C:\\Users\\CaiJianling\\Desktop\\MedSafeVault-备份.msvbackup',
          info: null,
          sealed: true,
        }
      case 'preview_backup': {
        const backupPassword = String(args[0] || '')
        if (backupPassword !== 'Backup#2026secret') throw new Error('备份密码不正确')
        return {
          info: {
            sealed: true,
            created_at: '2026-10-26 18:00:00',
            app_version: '2.0.0',
            vault_id: '8f2c1d7a4b9e6f30',
            pages: 4,
            records: 31,
            history: 96,
            has_recovery: true,
          } satisfies BackupInfo,
        }
      }
      case 'restore_backup':
        if (String(args[0] || '') !== 'Backup#2026secret') throw new Error('备份密码不正确')
        locked = false
        return {
          state: stateInfo(),
          info: { created_at: '2026-10-26 18:00:00', pages: 4, records: 31 },
          auto_backup: 'C:\\Users\\CaiJianling\\AppData\\Roaming\\MedSafeVault\\auto-before-restore-20261028.msvbackup',
        }
      case 'cancel_backup':
        return { ok: true }
      case 'set_settings': {
        requireUnlocked()
        const patch = (args[0] || {}) as Partial<Settings>
        if (patch.auto_lock_minutes != null) {
          const minutes = Number(patch.auto_lock_minutes)
          if (minutes < 0 || minutes > 240) throw new Error('自动锁定时间需在 0-240 分钟之间')
          settings = { ...settings, auto_lock_minutes: minutes }
        }
        if (patch.mask_usernames != null) settings = { ...settings, mask_usernames: Boolean(patch.mask_usernames) }
        if (patch.mask_addresses != null) settings = { ...settings, mask_addresses: Boolean(patch.mask_addresses) }
        if (patch.compact_rows != null) settings = { ...settings, compact_rows: Boolean(patch.compact_rows) }
        if (patch.securecrt_path != null) settings = { ...settings, securecrt_path: String(patch.securecrt_path) }
        if (patch.putty_path != null) settings = { ...settings, putty_path: String(patch.putty_path) }
        if (patch.xshell_path != null) settings = { ...settings, xshell_path: String(patch.xshell_path) }
        if (patch.winscp_path != null) settings = { ...settings, winscp_path: String(patch.winscp_path) }
        if (patch.vnc_viewer_path != null)
          settings = { ...settings, vnc_viewer_path: String(patch.vnc_viewer_path) }
        if (
          patch.ssh_client != null &&
          ['auto', 'builtin', 'securecrt', 'putty', 'xshell', 'openssh'].includes(String(patch.ssh_client))
        )
          settings = { ...settings, ssh_client: patch.ssh_client }
        if (
          patch.telnet_client != null &&
          ['auto', 'securecrt', 'putty', 'telnet'].includes(String(patch.telnet_client))
        )
          settings = { ...settings, telnet_client: patch.telnet_client }
        if (patch.file_client === 'builtin' || patch.file_client === 'winscp')
          settings = { ...settings, file_client: patch.file_client }
        if (patch.vnc_client === 'builtin' || patch.vnc_client === 'external')
          settings = { ...settings, vnc_client: patch.vnc_client }
        if (
          patch.rdp_fill != null &&
          ['user', 'password', 'none'].includes(String(patch.rdp_fill))
        )
          settings = { ...settings, rdp_fill: patch.rdp_fill }
        if (patch.close_action === 'tray' || patch.close_action === 'quit')
          settings = { ...settings, close_action: patch.close_action }
        if (patch.close_confirm != null)
          settings = { ...settings, close_confirm: Boolean(patch.close_confirm) }
        if (patch.table_font != null) settings = { ...settings, table_font: patch.table_font === 'sans' ? 'sans' : 'mono' }
        if (
          patch.ui_scale != null &&
          ['small', 'standard', 'large'].includes(String(patch.ui_scale))
        )
          settings = { ...settings, ui_scale: patch.ui_scale }
        if (
          patch.accent != null &&
          ['blue', 'sky', 'cyan', 'teal', 'emerald', 'violet', 'rose', 'amber'].includes(
            String(patch.accent),
          )
        )
          settings = { ...settings, accent: patch.accent }
        if (patch.ui_font != null) settings = { ...settings, ui_font: String(patch.ui_font).slice(0, 80) }
        if (patch.code_font != null)
          settings = { ...settings, code_font: String(patch.code_font).slice(0, 80) }
        return { settings }
      }
      case 'suggest_values': {
        requireUnlocked()
        const page = pageById(Number(args[0]))
        const key = String(args[1])
        const needle = String(args[2] || '').trim().toLowerCase()
        if (!page) return { values: [] }
        const column = page._base.find((item) => item.key === key)
        if (!column || column.type === 'password' || column.masked) return { values: [] }
        const seen: string[] = []
        for (const record of records
          .filter((item) => item.page_id === page.id && !item.deleted_at)
          .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))) {
          const text = String(record.data[key] ?? '').trim()
          if (!text) continue
          if (needle && !text.toLowerCase().includes(needle)) continue
          if (seen.some((item) => item.toLowerCase() === text.toLowerCase())) continue
          seen.push(text)
          if (seen.length >= 10) break
        }
        return { values: seen }
      }
      case 'reorder_records': {
        requireUnlocked()
        const pageId = Number(args[0])
        const wanted: number[] = []
        for (const raw of Array.isArray(args[1]) ? args[1] : []) {
          const id = Number(raw)
          if (Number.isFinite(id) && !wanted.includes(id)) wanted.push(id)
        }
        const picked = wanted
          .map((id) => records.find((item) => item.id === id && !item.deleted_at))
          .filter((item): item is MockRecord => Boolean(item && item.page_id === pageId))
        if (picked.length < 2) return { ok: true, moved: 0, skipped: [] }
        // Same rule as the backend: the selection is permuted inside the slots
        // it already occupies, so rows outside the selection do not move.
        const slots = picked.map((item) => records.indexOf(item)).sort((a, b) => a - b)
        const byId = new Map(picked.map((item) => [item.id, item]))
        const ordered = wanted.map((id) => byId.get(id)).filter(Boolean) as MockRecord[]
        ordered.forEach((item, index) => {
          records[slots[index]] = item
        })
        pushHistory('move_record', 'record', ordered[0].id, pageId, `调整 ${ordered.length} 行顺序`)
        return { ok: true, moved: ordered.length, skipped: [] }
      }
      case 'delete_records': {
        requireUnlocked()
        const ids = (Array.isArray(args[0]) ? args[0] : []).map((id) => Number(id))
        const moved: number[] = []
        for (const id of ids) {
          const record = records.find((item) => item.id === id)
          if (!record || record.deleted_at) continue
          const page = pageById(record.page_id)
          record.deleted_at = ISO(new Date())
          pushHistory(
            'delete_record',
            'record',
            record.id,
            record.page_id,
            `删除记录「${page ? titleFor(record, page._base) : '未命名'}」`,
            [mkChange('状态', '使用中', '回收站', 'status')],
          )
          moved.push(record.id)
        }
        if (!moved.length) throw new Error('选中的记录无法移入回收站')
        return { ok: true, moved, skipped: ids.length - moved.length }
      }
      case 'choose_securecrt':
        return { settings: { ...settings, securecrt_path: 'C:\\Program Files\\VanDyke Software\\Clients\\SecureCRT.exe' } }
      case 'get_about': {
        const about: AboutInfo = {
          version: '2.0.0',
          data_dir: stateInfo().data_dir,
          db_file: stateInfo().db_file,
          db_size: 2_487_296,
          python: '3.13.7',
          platform: 'Windows-11-10.0.26100-SP0',
          crypto: 'AES-256-GCM / PBKDF2-SHA256 (600,000)',
          stats: initialized ? stats() : null,
        }
        return { about }
      }
      case 'open_data_dir':
        return { ok: true }
      case 'open_path':
        return { ok: true }
      case 'get_data_location':
        return {
          location: {
            mode: demoLocation.mode as DataLocation['mode'],
            path: demoLocation.path,
            pending: demoPending as DataLocation['pending'],
            defaults: { appdata: DEMO_APPDATA_DIR, portable: 'D:\\MedSafeVault\\' + DEMO_PORTABLE_DIR },
            app_dir: 'D:\\MedSafeVault',
            config_path: 'D:\\MedSafeVault\\MedSafeVault.json',
            config_writable: true,
            frozen: false,
            env_override: '',
            size_bytes: 2_487_296,
          },
        }
      case 'set_data_location': {
        const mode = String(args[0] || 'appdata')
        const custom = String(args[1] || '').trim()
        const target =
          mode === 'appdata'
            ? DEMO_APPDATA_DIR
            : mode === 'portable'
              ? 'D:\\MedSafeVault\\' + DEMO_PORTABLE_DIR
              : custom
        demoPending = { mode, path: target, requested_at: new Date().toLocaleString() }
        return { pending: demoPending, location: { mode: demoLocation.mode, path: demoLocation.path } }
      }
      case 'cancel_data_location':
        demoPending = null
        return { pending: null }
      case 'choose_data_dir':
        return { path: 'D:\\科室资料\\MedSafeVault数据' }
      case 'get_environment':
        return {
          environment: { MEDSAFE_DATA_DIR: null, MSV_DEV_URL: 'http://localhost:5179', MSV_DEBUG: null },
        }
      case 'quit':
        return { ok: true }
      default:
        throw new Error(`演示模式未实现接口：${method}`)
    }
  })()
  return result as T
}

export const isMockOnly = Boolean(demoMode)
export { DEMO_PASSWORD }
