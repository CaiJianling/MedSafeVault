# MedSafeVault 更新服务（update/）

一个能发布桌面端新版本的小网站。跑在一台科室里常年开着的机器上，
提供两件事：

1. **给桌面端的更新接口** —— 程序启动时问一句「有没有新版」，有就下载、校验、替换、重启；
2. **给信息科用的管理后台** —— 打开浏览器就能登录、上传 exe、填版本号发布、回滚、下架。

只用 Python 标准库，**不需要 pip 安装任何东西**（`requirements.txt` 里说明了原因），
Linux 上有 `python3` 就能跑；管理页面是提前构建好的静态文件，服务器上不需要 Node。

---

## 1. 目录里都有什么

```
update/
  server.py            唯一入口：更新接口 + 管理后台 + 静态页面，一个端口全包
  admin.py             登录凭据、会话、上传暂存、静态托管、/api/admin/* 管理接口
  common.py            版本号、sha256、JSON 原子写等公用小函数
  make_release.py      命令行登记版本（不想开网页时用）
  versions.json        版本表：版本号 ↔ 文件位置 ↔ 大小 ↔ sha256 ↔ 说明
  requirements.txt     依赖说明（结论：没有第三方依赖）
  admin.json           管理后台登录凭据，首次启动自动生成，不进版本库
  files/               分发的 exe 都放这里（不进版本库）
    .uploads/          浏览器上传的暂存区，登记后搬进 files/
  web/                 管理页面源码（Vite + React 19 + HeroUI v3）
    dist/              构建产物，server.py 直接托管（入库，服务器上不用重新构建）
```

`versions.json` 长这样：

```json
{
  "latest": "2.1.0",
  "releases": [
    {
      "version": "2.1.0",
      "file": "files/MedSafeVault-2.1.0.exe",
      "notes": "新增两步验证；修复列表首行提示被表头遮挡",
      "mandatory": false,
      "released_at": "2026-11-05",
      "size": 28227388,
      "sha256": "…"
    }
  ]
}
```

`file` 是相对 `update/` 目录的路径；服务只会发送版本表里登记过的文件，
所以不存在目录穿越。`size` 与 `sha256` 留空也能自动补齐，但客户端永远自己校验。

---

## 2. 30 秒跑起来

```bash
# 本机试一下
python3 update/server.py --port 8000

# 浏览器打开
http://127.0.0.1:8000/
```

第一次启动会创建管理员账号。不给 `--password` 时随机生成一个并打印在终端上
（连同「桌面端设置里该填的地址」），登录后请在「账号与服务」里改掉：

```bash
python3 update/server.py --port 8000 --username admin --password '自己定一个至少8位的'
```

启动后终端会打印类似：

```
MedSafeVault 更新服务 (2.0.0)
  管理页面    http://0.0.0.0:8000/
  更新接口    http://0.0.0.0:8000/api/version
  当前最新    2.1.0
  应用「设置 → 关于 → 更新服务地址」里可以填：
      http://10.1.20.31:8000/
```

---

## 3. 管理后台怎么用

打开 `http://<服务器IP>:8000/` → 登录。页面从左到右、从上到下是这样：

登录页右上角和顶栏右侧都有**主题模式**三档：跟随系统 / 亮色 / 暗色，和桌面端同一套语义
（存的是选择意图，键名 `heroui-theme`；选「跟随系统」时浏览器深浅色一变页面立刻跟着变，
不用刷新），选定后写进这台电脑的 localStorage，下次打开还是这个样子。

**更新服务地址**（左上）
把这里的任意一条填到桌面端「设置 → 关于 → 更新服务地址」。带「当前页面」的那条
最稳（就是你正在访问的地址）；「服务器探测」是服务自己猜的内网 IP，多网卡时会有几条。
旁边有个「检查一次」按钮，用桌面端同样的方式问一遍接口，能立刻确认地址通不通。

**已发布的版本**（左下）
一行一个版本，显示大小、sha256、发布日期、文件位置，以及：

* **最新** —— 正在分发给桌面端的那一个；
* **必须更新** —— 桌面端弹窗不给「以后再说」；
* **文件缺失 / 散列不符 / 大小不符** —— 磁盘上的文件和版本表对不上，需要处理；
* 操作：**设为最新**（回滚就靠它，点一下就切到旧版本）、下载、**查看更新说明**、下架。
  点「查看更新说明」会在表格下方展开这块版本的详情：说明正文**默认按 Markdown 渲染**，就是桌面端用户看到的样子，
  下方「显示原文 / 预览效果」随时切回源码核对；另有发布日期、大小、sha256 与磁盘路径。
  面板里的「编辑说明」改成 textarea + 必须更新开关，保存后自动回到只读视图，立刻能看到新说明生效。
  没写说明的版本会明确提示「这条版本没有写更新说明，桌面端的更新弹窗里那段就是空的」。
  下架可以只删登记、保留文件，也可以连文件一起删。

**发布新版本**（右上）
两种来源，二选一：

* **上传文件** —— 把 exe 拖进框里（或点「选择文件」）。上传只是暂存到
  `files/.uploads/`，进度条走完后显示服务端算出的 sha256；填好版本号点「发布版本」
  才会搬进 `files/` 并写进版本表。文件名里没有版本号时会自动补上（`MedSafeVault.exe`
  → `MedSafeVault-2.1.0.exe`），避免堆在同名文件上。
* **用已有文件** —— 如果是 scp / U 盘拷进 `files/` 的构建产物，直接选它登记，不用再传一遍。

更新说明支持 **Markdown**（标题、列表、粗体、行内代码、代码块、引用、表格），普通换行会保留；
桌面端的更新弹窗按格式渲染，内容太长时在说明区里自己滚动。发布表单的占位示例就是一份可直接改的模板。

版本号只能写成点分数字（`2.1.0`、`2.1`、`2.0.0.1` 都行），比较规则是四段数字，
和桌面端 `backend/updater.py` 完全一致。

**账号与服务**（右中）
数据目录、版本表、暂存目录的路径（可复制）、上传上限、登录有效期，以及改口令。
改口令会让其他浏览器上的会话失效。

**最近操作**（右下）
谁在什么时候登录、上传、发布、下架了哪个版本。只在服务进程内存里，重启清空。

---

## 4. 桌面端怎么连

1. 桌面端「设置 → 关于 → 更新服务地址」填 `http://<服务器IP>:8000/`（末尾有没有 `/` 都行）；
2. 每次启动自动检查一次，发现新版会弹窗，写明版本号、大小、sha256 和更新说明；
3. 点「立即更新」后边下载边校验（支持断点续传），下完点「立即重启并更新」；
4. 万一窗口没自动回来，直接双击 `MedSafeVault.exe` 就是新版本，旧版本留在
   `MedSafeVault.exe.old`（弹窗和帮助页里都写了这句兜底话）。

没填地址的电脑不会检查更新，也不会报错。

---

## 5. 部署到 Linux 服务器

```bash
# 1) 把整个 update/ 拷到服务器（dist 已经在里面，不需要 Node）
scp -r update/ ops@10.1.20.31:/opt/msv-update/

# 2) 建一个不能登录的普通用户，别用 root 跑
sudo useradd --system --create-home --shell /usr/sbin/nologin msvupdate
sudo chown -R msvupdate:msvupdate /opt/msv-update

# 3) 首次创建管理员账号（跑完就退出）
sudo -u msvupdate python3 /opt/msv-update/server.py --set-password --username admin

# 4) systemd 托管：/etc/systemd/system/msv-update.service
```

```ini
[Unit]
Description=MedSafeVault 更新服务
After=network.target

[Service]
User=msvupdate
Group=msvupdate
WorkingDirectory=/opt/msv-update
ExecStart=/usr/bin/python3 /opt/msv-update/server.py --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now msv-update
sudo systemctl status msv-update --no-pager
sudo journalctl -u msv-update -f          # 看日志（登录、发布、下载都会记一行）

# 5) 放行端口（按发行版二选一）
sudo firewall-cmd --permanent --add-port=8000/tcp && sudo firewall-cmd --reload
sudo ufw allow 8000/tcp
```

要放行的东西只有 `update/` 目录：`versions.json` 和 `files/` 是数据，
建议连同 `admin.json` 一起定期备份（`admin.json` 里只有散列，不含明文口令）。

---

## 6. 想要 80 端口或 HTTPS（可选）

服务本身不监听 TLS。需要时用 nginx 反代，桌面端填 `https://msv.院内域名/` 即可
（`backend/updater.py` 对 http/https 都一样处理）：

```nginx
server {
  listen 80;
  server_name msv.hospital.internal;

  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # 大文件下载：别让 nginx 把响应缓冲成一整块
    proxy_buffering off;
    client_max_body_size 200m;
  }
}
```

注意：走反代后，「服务器探测」出来的地址仍是内网 IP，页面顶部的「当前页面」
那条才是用户实际访问的地址，以后者为准。

---

## 7. 命令行登记（不开网页时）

```bash
python3 update/make_release.py \
  --exe dist/MedSafeVault.exe \
  --version 2.1.0 \
  --notes "新增两步验证；修复列表首行提示被表头遮挡"
# 加 --mandatory 标记必须更新，--no-latest 只登记不置为最新，--dry-run 只看会写什么
```

它做的事和网页「发布新版本」一样：复制进 `files/`、算 size/sha256、按版本倒序写回
`versions.json`。两种写法可以混用，服务都是按文件 mtime 重新读版本表，改完立刻生效。

---

## 8. 启动参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--host` | `0.0.0.0` | 监听地址；只想本机试就写 `127.0.0.1` |
| `--port` | `8000` | 监听端口 |
| `--root` | 脚本所在目录 | 文件根目录，`versions.json` 与 `files/` 都在这里 |
| `--config` | `<root>/versions.json` | 版本表位置 |
| `--username` / `--password` | `admin` / 随机 | 仅首次创建账号时用；也可用环境变量 `MSV_UPDATE_USERNAME`、`MSV_UPDATE_PASSWORD` |
| `--set-password` | — | 只重置口令然后退出（忘记口令就用它） |
| `--credentials` | `<root>/admin.json` | 凭据文件位置 |
| `--dist` | `<root>/web/dist` | 管理页面目录 |
| `--session-hours` | `8` | 登录后免重复输入的小时数 |
| `--max-upload` | `500` | 单个上传文件上限（MB） |
| `--throttle` | `0` | 限速字节/秒，用来在慢速链路上看客户端进度条 |
| `--no-admin` | 关 | 只提供更新接口，不开管理后台（等价于旧版只读服务） |
| `--verbose` | 关 | 调试日志 |

---

## 9. 忘记口令 / 安全边界

* **忘记口令**：在服务器上执行 `python3 update/server.py --set-password`（或
  `--password '新口令'`），改完重启服务。没有「邮件找回」这类通道，本来也不该有。
* **口令存储**：`admin.json` 里只有用户名、随机盐和 PBKDF2-SHA256 散列（24 万次迭代），
  没有明文。
* **会话**：随机 token 的 `HttpOnly` / `SameSite=Lax` Cookie，默认 8 小时；
  所有写操作还要求页面自带的 `X-Msv-Requested-With` 头。
* **登录限速**：同一 IP 连续 5 次失败锁定 5 分钟，锁定期间即使口令正确也不放行。
* **文件访问**：只发送版本表里登记过的文件；上传只接受
  `.exe/.msi/.zip/.7z/.rar/.gz/.tar`；静态页面只在 `web/dist/` 里找。
* **完整性**：桌面端下载完自己算 sha256 并和版本表比对，不一致直接拒绝替换。
  这是「防传输损坏和防替换」，**不是**代码签名 —— 内网自签环境下没有可信根，
  版本表本身的可信度就等于这台服务器的可信度，所以别把它暴露在办公网之外。
* **没有 HTTPS**：默认明文。要跨机房或走公网就按第 6 节挂 nginx。

---

## 10. 接口清单

不需要登录（桌面端用的就是这几个）：

```bash
curl http://127.0.0.1:8000/healthz
curl "http://127.0.0.1:8000/api/version?current=2.0.0"
curl http://127.0.0.1:8000/api/releases
curl -OJ -H "Range: bytes=0-1023" http://127.0.0.1:8000/download/2.1.0
```

需要登录（管理页面用；写操作还要带 `X-Msv-Requested-With: msv-admin`）：

```
POST   /api/admin/login            {"username","password"}
POST   /api/admin/logout
GET    /api/admin/session           当前账号 + 服务详情
GET    /api/admin/releases          管理视图（含磁盘路径、是否存在、散列是否对得上）
GET    /api/admin/files             files/ 目录里有什么、分别被哪些版本登记
POST   /api/admin/upload?name=x.exe 请求体直接是文件字节 → 返回 upload token
POST   /api/admin/releases          {"version","notes","mandatory","latest","replace",
                                     "upload_token" 或 "existing_file","filename"}
PATCH  /api/admin/releases/<版本>    {"notes","mandatory","latest","released_at"}
DELETE /api/admin/releases/<版本>    {"delete_file": true|false}
POST   /api/admin/password          {"old_password","new_password"}
GET    /api/admin/audit             最近的登录与发布记录
```

---

## 11. 常见问题

**打开根路径只有一段 JSON，没有页面？**
`update/web/dist/` 没拷过去。开发机上 `cd update/web && npm install && npm run build`
重新生成，或直接把仓库里的 `update/web/dist/` 拷过去。

**登录提示「失败次数过多」？**
连续 5 次口令错误会锁定 5 分钟，等一会儿或换个正确的口令再试；急的话在服务器上
`--set-password` 重设。

**列表里出现「散列不符」？**
`files/` 里的文件被换过或损坏过。确认新文件没问题就重新发布同版本（勾选
「覆盖同版本」），否则下架，别让客户端下到一个校验不过的包。

**上传到一半失败 / 页面卡在上传中？**
暂存文件留在 `files/.uploads/`，超过 90 分钟自动清理；也可以点上传框右边的 ✕ 取消。
文件太大就调 `--max-upload`。

**发布后桌面端没提示更新？**
按顺序查三件事：桌面端填的地址能不能 `curl` 通；`/api/version?current=桌面端版本`
返回的 `latest` 是不是你刚发布的版本；版本号是不是真的比当前大（`2.1` 和 `2.1.0`
相等，不会提示）。

**Windows 上改了代码重启却没生效？**
Windows 允许两个进程同时绑同一端口（老的还在收包）。重启前先用
`netstat -ano | findstr :8000` 确认旧进程已经杀掉；Linux 没这个问题。

**想临时只跑只读接口？**
`python3 update/server.py --no-admin`，管理后台和登录都不启用，更新接口照常。

---

## 12. 改这个服务时怎么验证

```bash
.venv/Scripts/python.exe tools/test_updater.py        # 版本比较、接口契约、下载与替换
.venv/Scripts/python.exe tools/test_update_admin.py   # 登录、上传、登记、回滚、穿越防护
```

两套都在临时目录里跑，不会碰仓库的 `versions.json`、`files/`，也不会碰任何真实凭据。

管理页面的源码在 `update/web`，构建产物 `update/web/dist` 已经入库，所以**部署时不需要 Node**；
只有改版页面时才在开发机上重新构建一次：

```bash
cd update/web && npm run build     # 产物写进 update/web/dist，记得一起提交
```

`update/web/node_modules` 是指向 `web/node_modules` 的目录链接（Windows junction，Linux 上换成
`ln -s ../../web/node_modules update/web/node_modules`），这样两个前端共用同一份 HeroUI/React 依赖，
不会出现两份版本。**要新增依赖请在 `web/` 里 `npm install`**；如果确实想让 `update/web` 独立装包，
先删掉这个链接再在 `update/web` 里 `npm install --registry=https://registry.npmmirror.com`。
页面的样式是直接 `@import "../../../web/src/styles.css"` 复用桌面端那套 HeroUI 令牌，
所以后台的按钮、输入框、开关、表格和应用里长得一模一样。

