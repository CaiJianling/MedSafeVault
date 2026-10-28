# MedSafeVault · 医安密管平台

面向医院信息科的**本机密码与资产台账**。服务器、网络设备、应用系统、数据库的账号集中管理，全部数据只保存在这台电脑上，字段级加密、可撤回的修改历史、恢复密钥和自动锁定，为日常运维留下一份可靠底账。

原 tkinter 原型 `密码管理3.py` 的重构版本：Python + pywebview 负责本地服务与加密，React 19 + HeroUI v3 负责界面。

---

## 1. 功能一览

**台账与页面**

- 多标签页管理，内置「服务器 / 网络设备 / 应用系统 / 数据库」四类模板，也可从空白页或模板新建自定义页；每页可自由增删列、改列名、改列类型（文本 / 多行 / 数字 / 日期 / 账号 / 密码 / 链接 / 命令）。
- 列可拖拽排序、冻结、隐藏，超过 10 列时新增列会自动滚动到新列与底部添加按钮。
- 搜索框跨列模糊检索，支持按列筛选；行右键菜单可复制、编辑、连接、删除；行首多选框支持批量复制与批量移入回收站。
- 分页（每页 10/20/50/100 条 + 跳转页码）、紧凑行高、等宽字体列表。
- 输入框历史值联想：操作系统、厂商等列会提示本机已录入过的值（密码列永不联想）。

**安全**

- 打开密码（主密码）加解密，密码本身不落库；自动锁定倒计时可配置（0–240 分钟，默认 5 分钟），超时清除内存密钥。
- 所有敏感列字段级加密，密码列使用更高等级的独立子密钥；列表默认掩码显示，逐字段点击小眼睛才能查看，没有「全部显示」。
- 一次性恢复密钥（`.msvkey` 文件或 32 位恢复码）可强制重设打开密码，忘记主密码不会丢数据。
- 复制密码后剪贴板 30 秒自动清除；修改历史本身也是加密存储，支持撤销/重做与逐条回滚。
- 回收站保留被删除的记录，可还原或彻底清除；Excel 导入导出模板与列映射，加密备份（`.msvbackup`）导入导出。

**连接与工具**

- 一键 RDP（自动生成临时 `.rdp` 并带用户名/端口）、SecureCRT 会话（本机路径可在设置中指定）、浏览器打开地址。
- 单实例运行、亮/暗/跟随系统三态主题、8 种强调色、界面大小（小/标准/大）、界面字体与代码字体（读取系统字体）、中英文界面（跟随系统，可手动切换）；主题与配色存在密码库里，换机或换用户配置后打开仍是原来的样子。
- 内置帮助说明（顶栏问号，锁屏与首次设置页也有入口）：11 个小节覆盖加密模型、恢复密钥、数据目录搬移、备份迁移、Excel、远程连接、快捷键、环境变量与老旧终端部署，中英文同稿。

---

## 2. 架构

```
MedSafeVault.py            入口脚本（等价于 python -m backend.main）
backend/                   Python 侧：加密、存储、桥接
  crypto.py                AES-256-GCM / PBKDF2 / HKDF，两层密文格式
  store.py                 VaultService：库、页、列、记录、历史、回收站、备份、设置
  api.py                   暴露给前端的 js_api 门面（56 个方法）
  excelio.py               xlsx / xls / csv 读取与导出
  remote.py                RDP、SecureCRT、浏览器
  clipboard.py             Win32 剪贴板 + 定时清除
  paths.py                 资源目录 / 数据目录
  main.py                  单实例、日志、pywebview 窗口
web/                       React 19 + TypeScript + Vite + Tailwind 4 + HeroUI 3
  src/lib/api.ts           统一调用层：原生桥 / 浏览器演示模式
  src/lib/i18n.tsx         中文源串作键的中英文词典 + 后端文案翻译
  src/components/          锁屏、标签页、表格、抽屉、弹窗、设置等
tools/                     图标生成、打包、桌面/CDP 截图、自检脚本
```

前后端只通过 pywebview 注入的 `window.pywebview.api.<method>()` 通信，返回值统一为 `{ok: true, ...}` / `{ok: false, error, locked?}`；前端在 `ApiError` 一处集中翻译后端文案。没有网络端口监听，`http_server` 只在回环地址上为 WebView2 提供静态资源。

在纯浏览器（无原生桥）下会退化为演示模式：`src/lib/mock.ts` 用内存数据实现同一套接口，方便截图与 UI 校验，数据不落盘。

---

## 3. 开发

开发环境为 Python 3.13（64 位）+ Node.js 20+；更低版本未做兼容验证（Win7 需要独立的 3.8 工具链，见第 7 节）。全程不写注册表、不需要管理员权限（代码中无任何 `winreg` 调用）。

```bash
# 后端依赖（项目内虚拟环境）
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

# 国内镜像
.venv\Scripts\python.exe -m pip install -r requirements.txt ^
  -i https://pypi.tuna.tsinghua.edu.cn/simple

# 前端
cd web
npm install --registry=https://registry.npmmirror.com
npm run build          # 产出 web/dist，供 backend/main.py 直接加载
```

两种运行方式：

```bash
# 1) 加载已构建的前端（最接近发布形态）
npm run build --prefix web
.venv\Scripts\python.exe MedSafeVault.py

# 2) 前端热更新：先起 Vite，再让桌面端指向它
cd web && npm run dev
set MSV_DEV_URL=http://localhost:5179
..\.venv\Scripts\python.exe MedSafeVault.py
```

`MSV_DEBUG=1` 打开 WebView2 开发者工具。三个自检脚本：`tools/selftest.py` 无界面验证加密、导入导出与历史；`tools/test_location.py` 在临时目录里跑完数据目录搬移的全部分支；`tools/check_i18n.py` 扫描界面字符串，缺英文词条就报错（退出码 1）。`tools/desktop_shot.ps1` 启动真实窗口、模拟粘贴/按键并截取窗口位图，用于桌面端回归（注意它必须先声明 DPI 感知，否则截到的只是窗口左上角）。

> 维护提示：pywebview 在注入 `window.pywebview.api` 之前会递归遍历 `js_api` 对象的每个**公开**属性。因此 `backend/api.py` 的 `Api` 只能暴露方法，服务与窗口引用必须写成 `_service` / `_window` / `_attach`；否则它会顺着引用爬进 sqlite 连接和整个 WinForms/WebView2 对象树，UI 线程被占用数十秒并抛出「maximum recursion depth exceeded」，前端表现为「本地服务未就绪」。

---

## 4. 打包单文件 exe

```bash
.venv\Scripts\python.exe tools\make_icon.py     # 生成 assets/app.ico 与 app.png
.venv\Scripts\python.exe tools\build_exe.py     # npm run build + PyInstaller
.venv\Scripts\python.exe tools\build_exe.py --skip-web   # 复用现有 web/dist
```

产物为 `dist/MedSafeVault.exe`（onefile、无控制台窗口、不压缩 UPX），构建结束会打印体积与 sha256。配置见 `MedSafeVault.spec`：打包 `web/dist` 与 `assets`，收集 `webview` 全部子模块（`edgechromium` / `winforms`）、`clr`、`bottle`、`openpyxl`、`xlrd`；版本信息来自 `packaging/version_info.txt`。

当前产物 **24.4 MB**，`sha256 866f96f4aa627229ca07072f610535e275bcac9e955b0df75250f3963a35cd64`（Python 3.13 x64 构建，已在真机完成启动、解锁与数据目录搬移验证，见第 9 节）。换机器或改依赖后重新构建，以脚本打印值为准。

免管理员说明：onefile 解压到 `%TEMP%`，数据写入 `%APPDATA%\MedSafeVault`，不写注册表、不需要安装运行库，拷到任意可写目录即可运行。

---

## 5. 安全模型

| 项 | 取值 |
| --- | --- |
| 数据密钥 DEK | 随机 256 位，加密所有敏感字段 |
| 主密码派生 | PBKDF2-HMAC-SHA256，600,000 次迭代，随机 16 字节盐 |
| KEK 用途 | 仅包裹 DEK（AES-256-GCM，绑定 AAD），主密码本身不存储 |
| 字段密文 | `v1:<base64>`，AES-256-GCM，AAD `medsafe-vault/field/v1` |
| 密码字段 | `s1:<base64>`，密钥为 DEK 经 HKDF-SHA256（info `password-subkey/v1`）派生的子密钥 |
| 完整性校验 | 解锁时用 DEK 加密固定串验证，密钥错误立即失败 |
| 恢复密钥 | 独立 PBKDF2 派生的第二把 KEK，包裹同一个 DEK；文件绑定 `vault_id` 与代数 |
| 修改历史 | 与记录同库存储，diff 亦为密文 |

两层密文的意义：拿到 `vault.db` 且破解了普通字段密钥，仍需再派生一次才能读密码列。旧版本遗留的明文值会在下次解锁时自动重新封套（at-rest sweep），不改业务代码。

改主密码只重新包裹 DEK，历史密文与所有字段密文保持有效，无需全库重写。

**威胁模型边界**：本机防御性存储，不是保险柜级。解锁期间密钥在进程内存中，内存转储、键盘记录、以及 `%APPDATA%` 目录的文件读取权限都在防护范围之外。请保证 Windows 账户口令强度、开启 BitLocker，并把 `.msvkey` 存到与本机隔离的地方。

---

## 6. 数据位置与环境变量

数据目录有三种选择（设置 → 数据 → 数据目录），**改完重启生效**，退出时自动搬移：

| 模式 | 实际位置 | 用途 |
| --- | --- | --- |
| `%APPDATA%\MedSafeVault` | `%APPDATA%\MedSafeVault` | 默认，普通用户可写 |
| 应用程序所在目录 | `<程序目录>\MedSafeVaultData` | 数据随程序走，U 盘/共享盘 |
| 自定义目录 | 手填或浏览选择 | 加密盘、信息科指定位置 |

位置写在程序目录下的配置文件 `MedSafeVault.json`（首次启动自动生成）：

```json
{
  "version": 1,
  "data_location": { "mode": "appdata", "path": "C:\\Users\\…\\MedSafeVault" },
  "pending_location": { "mode": "portable", "path": "D:\\…\\MedSafeVaultData", "requested_at": "…" }
}
```

程序目录不可写（例如装在 `C:\Program Files`）时，配置文件自动改存 `%APPDATA%\MedSafeVault\MedSafeVault-location.json`；全程不写注册表。

搬移在 `webview.start()` 返回、数据库连接与日志句柄释放之后执行：复制 `vault.db`/`app.log`/`*.msvbackup` → 对新库跑 `PRAGMA integrity_check` → 改写配置文件 → 把旧目录改名为 `…-旧数据-<时间戳>` 保留（绝不直接删除），最后弹窗告知结果。`webview/` 是浏览器缓存，不参与搬移，会在新位置重建；改名遇到文件占用会重试约 4 秒，仍失败则保留原目录并在弹窗中提示手动删除。

数据目录内容：

```
vault.db          加密台账（SQLite，WAL 模式）
vault.db-wal/-shm 运行期临时文件，退出后自动合并
app.log           运行日志（1.5 MB × 3 轮转）
webview/          WebView2 用户数据
*.msvbackup       加密备份（含「恢复前自动备份」）
```

| 变量 | 作用 |
| --- | --- |
| `MEDSAFE_DATA_DIR` | 强制指定数据目录，优先级高于设置页；设置后本页选项变灰 |
| `MSV_DEV_URL` | 让桌面端加载 Vite 开发服务器 |
| `MSV_DEBUG` | `1` 打开开发者工具 |

备份与迁移：设置 → 导出加密备份得到 `.msvbackup`（密文，仍需主密码才能恢复），或导出 `.msvkey` 恢复密钥单独保管。整目录拷贝即完成迁移。

---

## 7. Windows 7 / WebView2 降级说明

**当前 exe 不能在 Win7 上运行**：它由 Python 3.13 x64 构建，而 python.org 官方从 3.9 起不再支持 Windows 7（官方文档明确「若需要 Windows 7 支持，请安装 Python 3.8」）。

Win7 终端要跑本项目，需要一条独立的 32 位工具链：

1. Python **3.8.x（32 位）**，需 SP1 + KB2533623；`cryptography` 选仍提供 `cp38-win32` 轮子的版本，`openpyxl`/`xlrd`/`bottle` 不受影响；`pywebview` 6.2.1 声明 `Requires-Python >=3.8`，但需在真机验证；PyInstaller 6.x 支持 3.8。
2. WebView2 运行时。Edge/WebView2 Evergreen 在 Win7/8.1 的最后一个版本是 **109**，2023 年 2 月后不再获得安全更新。可选：
   - **固定版本（Fixed Version）随应用分发**：把解压出的运行时目录放在 exe 同级，设置环境变量后启动，免安装、免管理员、不写注册表：
     ```bat
     set WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=%~dp0FixedVersionRuntime
     set WEBVIEW2_USER_DATA_FOLDER=%~dp0webview-cache
     start "" MedSafeVault.exe
     ```
     注意固定版本有独立生命周期，需定期换版并自行承担安全更新。
   - **Evergreen 离线独立安装包**（x86）在内部软件源分发；引导程序（Bootstrapper）需要联网，机房离线环境请用独立安装包。
3. 若某台 Win7 终端确实装不上 WebView2：pywebview 可回退 MSHTML（IE11 内核），但本项目使用 React 19、CSS 变量与 `backdrop-filter`，**IE11 下无法运行，这条路径不受支持**。这类终端建议升级 Win10，或以远程应用方式访问已部署的机器。

其他环境约束（Win7/Win10 通用）：不写注册表、不需要管理员权限、不依赖已安装的 Office（Excel 读写由 `openpyxl`/`xlrd` 完成）、依赖国内镜像离线安装。32 位系统请使用 x86 版运行时与 x86 构建产物。

---

## 8. 已知限制

- 加密只在字段层，SQLite 结构、列名、记录条数与「名称」列的明文索引可见，用于搜索与排序。
- 恢复密钥每次重新生成后旧文件立即失效；它是访问密码库的等价凭据，请按机密文件管理。
- 自动锁定基于最后操作时间，机器休眠期间的计时以唤醒后的活动为准。
- 演示模式（纯浏览器）不加密、不落盘，仅用于界面预览，不要在其中输入真实数据。

---

## 9. 验证记录

2026-10-28 在 Windows 11 + WebView2 真机完成多轮验证，截图见 `screenshots/19-26`：

- **源码运行**：启动 → 首次设置页 → 锁屏 → 输入密码解锁 → 主表格渲染正常（4 个页面、每页 2 条演示记录、密码列掩码 + 琥珀色高等级标记、自动锁定倒计时走时）。
- **单文件 exe**：`dist/MedSafeVault.exe` 直接读取同一数据目录，解锁后解密并渲染出与源码运行完全一致的记录，日志 `frozen=True` 且无异常。
- **亮色主题**：把 `settings.theme` 改成 light 后重启 exe，界面按密码库里的设置进入亮色（这一轮发现主题此前只存在浏览器本地存储、没有跟随设置，已在 `App.tsx` 修正为「设置优先 + 改动写回」）。
- **数据目录搬移**：把 exe 与配置放到临时目录，配置预置 `pending_location` 指向程序目录 → 启动解锁正常（`24`）→ Alt+F4 正常退出 → 弹窗告知新目录与归档目录（`25`）→ 校验 `%TEMP%\…\app\MedSafeVaultData\vault.db` 就位、旧目录改名为 `MedSafeVault-旧数据-<时间戳>`、配置文件改写为 `portable` → 再次启动从新目录解锁，记录完好（`26`）。这一轮暴露出日志句柄未释放导致旧目录改名失败，已在退出流程里先关闭文件日志并重试改名。

界面文案另用脚本做英文模式全量扫描：帮助页 11 个小节与设置四个标签页内无残留中文（仅语言菜单里的「中文」为有意保留），并按 WCAG 合成实际渲染色计算对比度，唯一低于 4.5:1 的是强调色实心按钮上的白字（4.1:1，与全站主按钮一致）。

加密链路经后端脚本核对：不同层级密文前缀、遗留明文重封套、`suggest_values` 不返回密码列、删除/撤销/重做与历史解密一致。界面在 900px 窄屏与应用最小 1140×700（大字号）下均无挤压。演示数据统一使用 `203.0.113.x` / `192.0.2.x` / `198.51.100.x` 等文档保留地址与 `demo_*` 账号。

尚未覆盖：Win7 真机（需第 7 节的 32 位工具链）、杀毒软件白名单场景、以及 32 位固定版本 WebView2 的实际渲染。
