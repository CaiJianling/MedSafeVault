/**
 * Built-in help. Content is deliberately data-driven: every string goes through
 * t(), so the English dictionary (and tools/check_i18n.py) covers the whole
 * manual. Nothing here invents a feature that the app does not have.
 */
import {
  ArchiveRestore,
  BookOpen,
  CircleHelp,
  FileSpreadsheet,
  FolderCog,
  HardDrive,
  KeyRound,
  Keyboard,
  Lightbulb,
  Monitor,
  Settings2,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import { DrawerFrame } from './primitives'

type SectionId =
  | 'start'
  | 'crypto'
  | 'recovery'
  | 'folder'
  | 'backup'
  | 'excel'
  | 'remote'
  | 'table'
  | 'env'
  | 'deploy'
  | 'faq'

const SECTIONS: { id: SectionId; title: string; icon: typeof BookOpen }[] = [
  { id: 'start', title: '快速上手', icon: BookOpen },
  { id: 'crypto', title: '加密与密钥', icon: ShieldCheck },
  { id: 'recovery', title: '恢复密钥', icon: KeyRound },
  { id: 'folder', title: '数据目录', icon: FolderCog },
  { id: 'backup', title: '备份与迁移', icon: ArchiveRestore },
  { id: 'excel', title: 'Excel 导入导出', icon: FileSpreadsheet },
  { id: 'remote', title: '远程连接', icon: Monitor },
  { id: 'table', title: '列表与快捷键', icon: Keyboard },
  { id: 'env', title: '环境变量', icon: Terminal },
  { id: 'deploy', title: '终端部署', icon: HardDrive },
  { id: 'faq', title: '常见问题', icon: Lightbulb },
]

function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[0.875rem] font-semibold tracking-tight text-ice-200">{children}</h3>
  )
}

function Para({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-[0.78125rem] leading-relaxed text-ice-500">{children}</p>
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2 text-[0.78125rem] leading-relaxed text-ice-500">
          <span className="mt-[0.5rem] size-1 shrink-0 rounded-full bg-[var(--msv-accent)]/70" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  )
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-[var(--msv-tint-strong)] px-1 py-0.5 font-mono text-[0.71875rem] text-ice-300">
      {children}
    </code>
  )
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-[var(--msv-tint)] px-1.5 py-0.5 font-mono text-[0.6875rem] text-ice-300">
      {children}
    </kbd>
  )
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="mt-2 space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5">
          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-[color-mix(in_srgb,var(--msv-accent)_35%,transparent)] bg-[var(--msv-accent-soft)] font-mono text-[0.6875rem] text-[var(--msv-accent-text)]">
            {index + 1}
          </span>
          <span className="min-w-0 text-[0.78125rem] leading-relaxed text-ice-500">{item}</span>
        </li>
      ))}
    </ol>
  )
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-line">
      <table className="w-full border-collapse text-[0.75rem]">
        <thead>
          <tr className="bg-[var(--msv-tint)] text-left text-ice-400">
            {head.map((cell) => (
              <th key={cell} className="px-3 py-2 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-line align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 leading-relaxed text-ice-500">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function HelpDrawer({
  open,
  onOpenChange,
  version,
  onOpenSettings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  version: string
  onOpenSettings?: () => void
}) {
  const { t } = useI18n()
  const anchors = useRef<Partial<Record<SectionId, HTMLDivElement | null>>>({})

  const jump = (id: SectionId) => {
    anchors.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <DrawerFrame
      open={open}
      onOpenChange={onOpenChange}
      width="760px"
      icon={<CircleHelp className="size-4" />}
      title={t('帮助说明')}
      description={t('医安密管平台 {v} · 加密、数据目录与日常操作说明', { v: version })}
      bodyHeader={
              <nav className="flex flex-wrap gap-1.5">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => jump(section.id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-[var(--msv-tint)] px-2.5 py-1 text-[0.71875rem] text-ice-400 transition hover:border-line-strong hover:text-ice-100"
          >
            <section.icon className="size-3" />
            {t(section.title)}
          </button>
        ))}
      </nav>
      }
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[0.71875rem] text-ice-600">
            <ShieldCheck className="size-3" />
            {t('所有数据只保存在本机，不会上传到任何服务器。')}
          </span>
          <div className="flex items-center gap-2">
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[0.75rem] text-ice-300 transition hover:border-line-strong hover:text-ice-100"
              >
                <Settings2 className="size-3.5" />
                {t('打开设置')}
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--msv-accent)] px-3 text-[0.75rem] font-medium text-white transition hover:brightness-110"
            >
              <X className="size-3.5" />
              {t('关闭')}
            </button>
          </div>
        </div>
      }
    >

      <div className="space-y-6">
        <div
          className="scroll-mt-2"
          ref={(node) => {
            anchors.current.start = node
          }}
        >
          <Heading>{t('快速上手')}</Heading>
          <Para>
            {t('本软件是信息科自用的本机密码与资产台账：服务器、网络设备、应用系统、数据库的账号集中记录在一台电脑上，字段级加密，不联网、不同步。')}
          </Para>
          <Steps
            items={[
              t('首次启动设置一个打开密码（至少 8 位，建议 12 位以上），它只用于解锁，不会保存在磁盘上。'),
              t('立刻导出恢复密钥文件，或抄下 32 位恢复码，存到与这台电脑分开的地方。'),
              t('用顶部标签页分类：服务器、网络设备、应用系统、数据库，也可以新建自定义页面并自行配置列。'),
              t('录入时用行内小眼睛核对密码；离开座位点右上角「锁定」，或等待自动锁定倒计时结束。'),
              t('定期在设置 → 数据中导出加密备份，并把备份文件放到共享盘。'),
            ]}
          />
        </div>

        <div
          className="scroll-mt-2"
          ref={(node) => {
            anchors.current.crypto = node
          }}
        >
          <Heading>{t('加密与密钥')}</Heading>
          <Bullets
            items={[
              <>
                {t('随机生成的 256 位数据密钥（DEK）负责加密内容；打开密码通过')} <Code>PBKDF2-HMAC-SHA256 · 600,000</Code> {t('次迭代派生出包裹密钥（KEK），只用来包裹 DEK，密码本身不落盘。')}
              </>,
              <>
                {t('每个字段单独用')} <Code>AES-256-GCM</Code> {t('加密并绑定用途标签，密文前缀')} <Code>v1:</Code>{t('；密码字段再经 HKDF 派生出更高等级的子密钥，前缀')} <Code>s1:</Code>{t('，两者互不通用。')}
              </>,
              <>
                {t('修改历史、回收站内容与备份文件同样是密文。列表默认掩码显示，只有点击该行该字段的小眼睛才会解密这一个值，没有「全部显示」。')}
              </>,
              <>
                {t('复制密码后剪贴板会在 30 秒后自动清除；修改打开密码只重新包裹 DEK，历史密文保持有效。')}
              </>,
              <>
                {t('边界：解锁期间密钥在进程内存里。请同时保证 Windows 账户口令强度并开启 BitLocker——本机加密不替代磁盘加密。')}
              </>,
            ]}
          />
        </div>

        <div
          className="scroll-mt-2"
          ref={(node) => {
            anchors.current.recovery = node
          }}
        >
          <Heading>{t('恢复密钥与忘记密码')}</Heading>
          <Para>
            {t('恢复密钥是第二把独立包裹 DEK 的钥匙。忘记打开密码时可以用它重设密码，数据不会丢失。')}
          </Para>
          <Steps
            items={[
              t('设置 → 安全 → 恢复密钥：生成或重新生成，然后「导出恢复密钥文件」保存 .msvkey，或查看 32 位恢复码。'),
              t('在锁屏页点「使用恢复密钥」，导入 .msvkey 文件或输入恢复码。'),
              t('设置一个新的打开密码，旧密码即刻失效，其余数据保持不变。'),
            ]}
          />
          <Para>
            {t('注意：每次重新生成，旧文件立即失效；恢复密钥等同于访问密码库的凭据，请与密码分开保管。若打开密码与恢复密钥同时丢失，数据无法找回。')}
          </Para>
        </div>

        <div
          className="scroll-mt-2"
          ref={(node) => {
            anchors.current.folder = node
          }}
        >
          <Heading>{t('数据目录')}</Heading>
          <Para>
            {t('密码库、日志与备份保存在同一个数据目录。设置 → 数据 提供三种位置，选定后重启生效：')}
          </Para>
          <Table
            head={[t('选项'), t('实际位置'), t('适用场景')]}
            rows={[
              [
                t('%APPDATA%\\MedSafeVault'),
                <Code key="p">%APPDATA%\\MedSafeVault</Code>,
                t('默认。普通用户可写，不需要管理员权限。'),
              ],
              [
                t('应用程序所在目录'),
                <Code key="p">&lt;{t('程序目录')}&gt;\\MedSafeVaultData</Code>,
                t('数据跟着程序走，适合拷到移动硬盘或从共享盘运行。'),
              ],
              [
                t('自定义目录'),
                <Code key="p">D:\\…</Code>,
                t('放到加密盘或信息科指定的存储位置。'),
              ],
            ]}
          />
          <Bullets
            items={[
              t('位置记录在程序目录下的配置文件 MedSafeVault.json，首次启动自动创建；若程序目录不可写（例如装在 C:\\Program Files），配置自动改存到 %APPDATA%\\MedSafeVault。'),
              t('退出程序时执行搬移：先把数据库、日志与备份复制到新目录，再对新库做完整性校验，通过后更新配置文件，最后把旧目录改名保留，不会直接删除。'),
              t('浏览器缓存目录 webview 不参与搬移，它会在新位置自动重建。'),
              t('若设置了环境变量 MEDSAFE_DATA_DIR，它以环境变量为准，页面上的选项会变灰不可选。'),
              t('目标目录必须为空或不含密码库文件；不允许与当前目录相互嵌套，也不建议使用盘符根目录。'),
            ]}
          />
        </div>

        <div
          className="scroll-mt-2"
          ref={(node) => {
            anchors.current.backup = node
          }}
        >
          <Heading>{t('备份与迁移')}</Heading>
          <Bullets
            items={[
              <>
                {t('设置 → 数据 → 导出加密备份得到')} <Code>.msvbackup</Code>{t('文件；整个文件都由导出时设置的备份密码加密，导入时只需验证这个备份密码，不需要当初的打开密码。')}
              </>,
              t('备份密码与保险库的打开密码相互独立：忘记打开密码用恢复密钥，忘记备份密码则该备份文件无法读取。'),
              <>
                {t('恢复备份前，程序会先自动导出一份当前数据的备份（')}
                <Code>auto-before-restore-*.msvbackup</Code>
                {t('），避免误覆盖。')}
              </>,
              t('换电脑：把整个数据目录拷过去，或在新机器上用备份文件恢复，再导入恢复密钥即可。'),
              t('只拷贝 vault.db 是安全的做法之一，但请连同 .msvkey 一起归档，否则忘记密码将无法重设。'),
            ]}
          />
        </div>

        <div
          className="scroll-mt-2"
          ref={(node) => {
            anchors.current.excel = node
          }}
        >
          <Heading>{t('Excel 导入导出')}</Heading>
          <Bullets
            items={[
              t('列表右上角「Excel」下拉菜单：下载模板、导入、导出当前页。'),
              t('模板按当前页的列生成，第一行是列名；导入支持 xlsx / xls / csv，无需安装 Office。'),
              t('导出时可勾选「用密码保护工作簿」，Excel 打开时会要求输入这个密码；导入带密码的文件时会先弹窗要求验证。'),
              t('导入前会显示列映射与样例预览，对不上的列留空，可先小批量试导。'),
              t('导出包含密码列的明文，请在共享盘上注意访问权限；如果只是交接，建议改用加密备份。'),
            ]}
          />
        </div>

        <div
          className="scroll-mt-2"
          ref={(node) => {
            anchors.current.remote = node
          }}
        >
          <Heading>{t('远程连接')}</Heading>
          <Bullets
            items={[
              t('行内链接按钮或右键菜单可直接连接：RDP、SecureCRT 会话、浏览器打开地址。'),
              <>
                {t('RDP 会在数据目录生成带用户名与端口的临时 .rdp 文件再调用系统 mstsc；端口、地址取自该行的列值。')}
              </>,
              t('SecureCRT 需要在设置 → 数据中指定程序路径（通常无需管理员权限，绿色版也可）。'),
              t('连接工具本身不在软件内嵌，因此不会额外开放端口，也不会修改系统远程设置。'),
            ]}
          />
        </div>

        <div
          className="scroll-mt-2"
          ref={(node) => {
            anchors.current.table = node
          }}
        >
          <Heading>{t('列表与快捷键')}</Heading>
          <Table
            head={[t('操作'), t('说明')]}
            rows={[
              [<Key key="k">{t('双击行')}</Key>, t('打开编辑窗口；也可以点行尾的铅笔图标。')],
              [<Key key="k">{t('右键行')}</Key>, t('快捷菜单：复制整行、编辑、连接、移入回收站。')],
              [<Key key="k">{t('行首多选框')}</Key>, t('批量复制或批量移入回收站，顶部会出现批量操作条。')],
              [<Key key="k">{t('小眼睛')}</Key>, t('仅显示该单元格一个密码，掩码不会一次性全部展开。')],
              [
                <Key key="k">Ctrl + Z</Key>,
                <>
                  {t('撤销上一步修改；')} <Key key="y">Ctrl + Y</Key> {t(' 或 ')}
                  <Key key="c">Ctrl + Shift + Z</Key> {t(' 重做。')}
                </>,
              ],
              [<Key key="k">Esc</Key>, t('清空页码输入框、关闭浮层菜单。')],
            ]}
          />
          <Bullets
            items={[
              t('页面设置抽屉里可以增删列、改列名与列类型、冻结列、调宽度、拖顺序；列很多时新增会自动滚动到新列。'),
              t('搜索框跨列模糊匹配；下方可切换每页条数并跳转到指定页码。'),
              t('操作系统、厂商等列会联想本机已录入过的值，密码列永不联想、也不会出现在提示里。'),
              t('设置 → 常规 中可切换列表等宽字体、界面字体与代码字体、界面大小（小/标准/大）、强调色与亮暗主题。'),
            ]}
          />
        </div>

        <div
          className="scroll-mt-2"
          ref={(node) => {
            anchors.current.env = node
          }}
        >
          <Heading>{t('环境变量')}</Heading>
          <Para>
            {t('环境变量只影响本机当前用户或启动脚本，不写入注册表。临时使用可在命令行里设置后再启动程序：')}
          </Para>
          <Para>
            <Code>set MEDSAFE_DATA_DIR=D:\IT\vault-data &amp;&amp; MedSafeVault.exe</Code>
          </Para>
          <Table
            head={[t('变量'), t('作用')]}
            rows={[
              [
                <Code key="c">MEDSAFE_DATA_DIR</Code>,
                t('强制指定数据目录，优先级高于设置页的选择；用于测试或多环境隔离。'),
              ],
              [
                <Code key="c">MSV_DEV_URL</Code>,
                t('让桌面端加载本地前端开发服务器，仅用于开发调试。'),
              ],
              [
                <Code key="c">MSV_DEBUG</Code>,
                t('设为 1 时启动附带 WebView2 开发者工具。'),
              ],
            ]}
          />
        </div>

        <div
          className="scroll-mt-2"
          ref={(node) => {
            anchors.current.deploy = node
          }}
        >
          <Heading>{t('在老旧终端上部署')}</Heading>
          <Bullets
            items={[
              t('Windows 10 / 11：直接运行 exe，系统一般已内置 WebView2 运行时。'),
              t('Windows 7 / 8.1：界面依赖 WebView2。Evergreen 版在 Win7 上停留在 Edge 109，早已不再获得安全更新，因此建议随程序分发「固定版本」运行时，或把该终端升级到 Win10。'),
              t('固定版本用法：把解压出的运行时目录放在 exe 同级，启动前设置 WEBVIEW2_BROWSER_EXECUTABLE_FOLDER 指向它，免安装、免管理员、不写注册表。'),
              t('32 位终端需要 32 位构建产物（配套的 32 位 Python 工具链），不能直接运行 64 位 exe。'),
              t('部署约束：单文件 exe 免安装，解压到临时目录运行；数据写入用户目录；不写注册表、不安装服务、不开放端口。'),
              t('离线安装依赖请使用国内镜像：pip 用 pypi.tuna.tsinghua.edu.cn/simple，npm 用 registry.npmmirror.com。'),
            ]}
          />
        </div>

        <div
          className="scroll-mt-2"
          ref={(node) => {
            anchors.current.faq = node
          }}
        >
          <Heading>{t('常见问题')}</Heading>
          <Bullets
            items={[
              t('忘记打开密码：在锁屏页用恢复密钥重设，数据不受影响。两者都丢了则无法找回。'),
              t('自动锁定时间到：内存密钥已清除，窗口仍在但需要重新输入密码；这段时间内数据仍是密文。'),
              t('文字太小或发虚：设置 → 常规 → 界面大小 选择「大」，或更换界面/列表字体。'),
              t('换了 Windows 用户或机器：把数据目录整体拷到新机器的同一路径，或在新机器上恢复备份。'),
              t('在浏览器里直接打开 web/dist/index.html 是演示模式，数据不落盘也不加密，请不要输入真实账号。'),
              t('想改数据目录：设置 → 数据 → 数据目录，选好后退出程序，搬移会在退出时自动完成并提示结果。'),
            ]}
          />
        </div>
      </div>
    </DrawerFrame>
  )
}
