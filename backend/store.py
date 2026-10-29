"""Core vault service: encryption, pages, records, history, recycle bin.

Everything sensitive is encrypted with a random DEK that never touches disk in
plaintext. The master password and the recovery code are two independent
wrappers around that DEK.
"""
from __future__ import annotations

import hmac
import json
import logging
import re
import sqlite3
import threading
import time
import uuid
from datetime import datetime
from typing import Any, Iterable

from . import __version__
from .crypto import (
    SECRET_TOKEN_PREFIX,
    TOKEN_PREFIX,
    CryptoError,
    KDF_ALGORITHM,
    KDF_ITERATIONS,
    b64d,
    b64e,
    check_verifier,
    derive_kek,
    derive_recovery_kek,
    derive_secret_key,
    is_backup_envelope,
    is_secret_token,
    make_verifier,
    new_dek,
    new_recovery_code,
    new_salt,
    normalize_recovery_code,
    open_backup,
    seal_backup,
    open_field,
    password_score,
    random_password,
    seal_field,
    token_prefix,
    unwrap_dek,
    unwrap_from_recovery,
    wrap_dek,
    wrap_for_recovery,
)
from .paths import data_dir, db_path

log = logging.getLogger(__name__)

# Selectable accent palettes; the CSS in web/src/styles.css defines each hue.
ACCENTS = (
    "blue", "sky", "cyan", "teal", "emerald", "violet", "rose", "amber",
)
# Font family names are handed to CSS inside quotes, so a denylist is enough:
# block whatever could terminate the value or escape the declaration. Real
# Windows names contain parentheses, commas and CJK, which the old allowlist
# rejected and made the Settings pickers look dead.
_FONT_BAD_RE = re.compile(r'["\\;{}<>\r\n\t]')


def _clean_font_name(value: object) -> str:
    """Trim a font family name to something safe to interpolate into CSS."""
    text = str(value or "").strip()[:80]
    if not text:
        return ""
    if _FONT_BAD_RE.search(text):
        raise VaultError("字体名称不合法")
    return text

MASK = "••••••••"
HISTORY_APPLIED = 0
HISTORY_UNDONE = 1
HISTORY_DISCARDED = 2

COLUMN_TYPES = ("text", "password", "number", "select", "textarea", "date", "url")
CONNECT_MODES = ("auto", "ssh", "rdp", "telnet", "ftp", "sftp", "vnc")
SSH_CLIENTS = ("auto", "builtin", "securecrt", "putty", "xshell", "openssh")
TELNET_CLIENTS = ("auto", "securecrt", "putty", "telnet")
FILE_CLIENTS = ("builtin", "winscp")
VNC_CLIENTS = ("builtin", "external")
RDP_FILLS = ("user", "password", "none")
ICONS = (
    "server", "network", "database", "app", "cloud", "shield",
    "key", "grid", "terminal", "globe", "lock", "folder",
    "monitor", "printer", "cctv", "storage", "users", "medical",
)

# Excel header aliases, intentionally compatible with the old prototype.
HEADER_ALIASES: dict[str, list[str]] = {
    "type": ["类型", "type", "设备类型", "服务器类型"],
    "subtype": ["子类型", "二级类型", "subtype"],
    "address": ["服务器地址", "地址", "ip", "ip地址", "address", "主机地址", "管理地址", "访问地址"],
    "app": ["应用名称", "应用", "系统名称", "app", "application", "名称", "设备名称", "实例名称"],
    "os": ["操作系统", "os", "系统", "品牌型号"],
    "username": ["用户名", "账号", "username", "user", "登录名"],
    "password": ["密码", "password", "passwd", "pwd"],
    "port": ["服务器端口", "端口", "port", "ports"],
    "note": ["备注", "note", "remark", "说明"],
    "oob": ["带外管理", "带外", "oob", "带外地址"],
    "oob_user": ["带外用户名", "带外账号", "oob_user", "oob用户名"],
    "oob_pass": ["带外密码", "oob_pass", "oob密码"],
}


class VaultError(Exception):
    """A user-facing error."""


class VaultLocked(VaultError):
    """Raised when the vault must be unlocked before the operation."""


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def _column_template(key: str, label: str, type_: str = "text", *, encrypted: bool = False,
                     masked: bool = False, width: int = 160, options: list[str] | None = None,
                     placeholder: str = "", required: bool = False) -> dict:
    return {
        "key": key,
        "label": label,
        "type": type_,
        "encrypted": encrypted,
        "masked": masked,
        "width": width,
        "visible": True,
        "required": required,
        "options": options or [],
        "placeholder": placeholder,
    }


PAGE_TEMPLATES: list[dict] = [
    {
        "id": "server",
        "name": "服务器",
        "icon": "server",
        "description": "物理机、虚拟机与云主机",
        "columns": [
            _column_template("type", "类型", "select", width=100,
                             options=["物理机", "虚拟机", "云主机", "其他"]),
            _column_template("address", "服务器地址", width=150, placeholder="203.0.113.10"),
            _column_template("app", "应用名称", width=180),
            _column_template("os", "操作系统", width=150, placeholder="CentOS 7 / Windows"),
            _column_template("username", "用户名", encrypted=True, width=130),
            _column_template("password", "密码", "password", encrypted=True, masked=True, width=150),
            _column_template("port", "端口", width=80, placeholder="22"),
            _column_template("oob", "带外地址", width=150),
            _column_template("oob_user", "带外用户名", encrypted=True, width=130),
            _column_template("oob_pass", "带外密码", "password", encrypted=True, masked=True, width=140),
            _column_template("note", "备注", "textarea", width=220),
        ],
    },
    {
        "id": "network",
        "name": "网络设备",
        "icon": "network",
        "description": "交换机、路由器与安全设备",
        "columns": [
            _column_template("type", "设备类型", "select", width=110,
                             options=["交换机", "路由器", "防火墙", "负载均衡", "无线控制器", "其他"]),
            _column_template("address", "管理地址", width=150),
            _column_template("app", "设备名称", width=180),
            _column_template("os", "品牌型号", width=160),
            _column_template("username", "用户名", encrypted=True, width=130),
            _column_template("password", "密码", "password", encrypted=True, masked=True, width=150),
            _column_template("port", "端口", width=80),
            _column_template("note", "备注", "textarea", width=220),
        ],
    },
    {
        "id": "app",
        "name": "应用系统",
        "icon": "app",
        "description": "业务系统与网站账号",
        "columns": [
            _column_template("app", "系统名称", width=200),
            _column_template("address", "访问地址", width=220, placeholder="https://"),
            _column_template("username", "用户名", encrypted=True, width=150),
            _column_template("password", "密码", "password", encrypted=True, masked=True, width=170),
            _column_template("note", "备注", "textarea", width=240),
        ],
    },
    {
        "id": "database",
        "name": "数据库",
        "icon": "database",
        "description": "数据库实例与连接账号",
        "columns": [
            _column_template("app", "实例名称", width=180),
            _column_template("address", "主机地址", width=160),
            _column_template("port", "端口", width=90, placeholder="1972"),
            _column_template("username", "用户名", encrypted=True, width=150),
            _column_template("password", "密码", "password", encrypted=True, masked=True, width=170),
            _column_template("note", "备注", "textarea", width=240),
        ],
    },
    {
        "id": "blank",
        "name": "新页面",
        "icon": "grid",
        "description": "从基础字段开始",
        "columns": [
            _column_template("app", "名称", width=200, required=True),
            _column_template("username", "用户名", encrypted=True, width=160),
            _column_template("password", "密码", "password", encrypted=True, masked=True, width=180),
            _column_template("note", "备注", "textarea", width=240),
        ],
    },
    {
        "id": "other",
        "name": "其他账号",
        "icon": "key",
        "description": "零散账号与密钥",
        "columns": [
            _column_template("app", "名称", width=200, required=True),
            _column_template("username", "用户名", encrypted=True, width=160),
            _column_template("password", "密码", "password", encrypted=True, masked=True, width=180),
            _column_template("note", "备注", "textarea", width=240),
        ],
    },
]

DEFAULT_PAGE_IDS = ["server", "network", "app", "database"]


def template_by_id(template_id: str) -> dict:
    for item in PAGE_TEMPLATES:
        if item["id"] == template_id:
            return item
    return PAGE_TEMPLATES[-1]


def _slug_key(existing: set[str]) -> str:
    while True:
        key = "c_" + uuid.uuid4().hex[:8]
        if key not in existing:
            return key


class VaultService:
    def __init__(self, db_file: str | None = None):
        self.db_file = str(db_file or db_path())
        self.conn = sqlite3.connect(self.db_file, check_same_thread=False, timeout=15)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self._lock = threading.RLock()
        self.key: bytes | None = None
        self.secret_key: bytes | None = None
        self._swept = False
        self.pending_dek: bytes | None = None
        self.lock_reason: str | None = "startup"
        self.last_activity = time.monotonic()
        self._pending_recovery: dict | None = None
        self._init_schema()
        if self.has_master():
            self.lock_reason = "startup"

    # ------------------------------------------------------------------ meta
    def _init_schema(self) -> None:
        with self.conn:
            self.conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS meta(
                    k TEXT PRIMARY KEY,
                    v TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS pages(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    icon TEXT NOT NULL DEFAULT 'grid',
                    description TEXT NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                CREATE TABLE IF NOT EXISTS page_columns(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
                    key TEXT NOT NULL,
                    label TEXT NOT NULL,
                    type TEXT NOT NULL DEFAULT 'text',
                    encrypted INTEGER NOT NULL DEFAULT 0,
                    masked INTEGER NOT NULL DEFAULT 0,
                    frozen INTEGER NOT NULL DEFAULT 0,
                    width INTEGER NOT NULL DEFAULT 160,
                    visible INTEGER NOT NULL DEFAULT 1,
                    required INTEGER NOT NULL DEFAULT 0,
                    options TEXT NOT NULL DEFAULT '[]',
                    placeholder TEXT NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(page_id, key)
                );
                CREATE TABLE IF NOT EXISTS records(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
                    data TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                CREATE TABLE IF NOT EXISTS history(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    entity TEXT NOT NULL,
                    entity_id INTEGER,
                    page_id INTEGER,
                    title TEXT NOT NULL,
                    before TEXT,
                    after TEXT,
                    created_at TEXT NOT NULL,
                    state INTEGER NOT NULL DEFAULT 0,
                    undoable INTEGER NOT NULL DEFAULT 1
                );
                CREATE INDEX IF NOT EXISTS idx_records_page ON records(page_id, deleted_at);
                CREATE INDEX IF NOT EXISTS idx_history_state ON history(state, id);
                CREATE INDEX IF NOT EXISTS idx_columns_page ON page_columns(page_id, sort_order);
                """
            )
            column_names = {
                row["name"]
                for row in self.conn.execute("PRAGMA table_info(page_columns)").fetchall()
            }
            if "frozen" not in column_names:
                self.conn.execute(
                    "ALTER TABLE page_columns ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0"
                )
            if self._meta_get("schema_version") is None:
                self._meta_set("schema_version", "3")

    def _meta_get(self, key: str, default: str | None = None) -> str | None:
        row = self.conn.execute("SELECT v FROM meta WHERE k=?", (key,)).fetchone()
        return row["v"] if row else default

    def _meta_set(self, key: str, value: str, commit: bool = False) -> None:
        self.conn.execute(
            "INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
            (key, value),
        )
        if commit:
            self.conn.commit()

    def has_master(self) -> bool:
        return bool(self._meta_get("salt_master"))

    def get_settings(self) -> dict:
        defaults = {
            "auto_lock_minutes": 5,
            "theme": "system",
            "securecrt_path": "",
            "putty_path": "",
            "xshell_path": "",
            "winscp_path": "",
            "vnc_viewer_path": "",
            "ssh_client": "auto",
            "telnet_client": "auto",
            "file_client": "builtin",
            "vnc_client": "builtin",
            "rdp_fill": "user",
            "close_action": "tray",
            "close_confirm": True,
            "mask_usernames": False,
            "mask_addresses": False,
            "compact_rows": False,
            "table_font": "mono",
            "ui_scale": "standard",
            "accent": "blue",
            "ui_font": "",
            "code_font": "",
        }
        raw = _loads(self._meta_get("settings"), {})
        if not isinstance(raw, dict):
            raw = {}
        settings = {**defaults, **raw}
        try:
            settings["auto_lock_minutes"] = int(settings["auto_lock_minutes"])
        except Exception:
            settings["auto_lock_minutes"] = 5
        settings["auto_lock_minutes"] = max(0, min(settings["auto_lock_minutes"], 240))
        if settings.get("theme") not in ("dark", "light", "system"):
            settings["theme"] = "system"
        if settings.get("table_font") not in ("mono", "sans"):
            settings["table_font"] = "mono"
        if settings.get("ui_scale") not in ("small", "standard", "large"):
            settings["ui_scale"] = "standard"
        if settings.get("accent") not in ACCENTS:
            settings["accent"] = "blue"
        for key, allowed in (
            ("ssh_client", SSH_CLIENTS),
            ("telnet_client", TELNET_CLIENTS),
            ("file_client", FILE_CLIENTS),
            ("vnc_client", VNC_CLIENTS),
            ("rdp_fill", RDP_FILLS),
        ):
            if settings.get(key) not in allowed:
                settings[key] = defaults[key]
        if settings.get("close_action") not in ("tray", "quit"):
            settings["close_action"] = "tray"
        for font_key in ("ui_font", "code_font"):
            try:
                settings[font_key] = _clean_font_name(settings.get(font_key))
            except VaultError:
                settings[font_key] = ""
        return settings

    def _save_settings(self, settings: dict) -> None:
        self._meta_set("settings", _json(settings), commit=True)

    def set_settings(self, patch: dict) -> dict:
        with self._lock:
            settings = self.get_settings()
            if "auto_lock_minutes" in patch:
                try:
                    minutes = int(patch["auto_lock_minutes"])
                except Exception:
                    raise VaultError("自动锁定时间无效")
                if minutes < 0 or minutes > 240:
                    raise VaultError("自动锁定时间需在 0-240 分钟之间")
                settings["auto_lock_minutes"] = minutes
            if "theme" in patch:
                if patch["theme"] not in ("dark", "light", "system"):
                    raise VaultError("主题无效")
                settings["theme"] = patch["theme"]
            for path_key in (
                "securecrt_path",
                "putty_path",
                "xshell_path",
                "winscp_path",
                "vnc_viewer_path",
            ):
                if path_key in patch:
                    settings[path_key] = str(patch[path_key] or "")[:500]
            for key, allowed in (
                ("ssh_client", SSH_CLIENTS),
                ("telnet_client", TELNET_CLIENTS),
                ("file_client", FILE_CLIENTS),
                ("vnc_client", VNC_CLIENTS),
                ("rdp_fill", RDP_FILLS),
            ):
                if key in patch:
                    if patch[key] not in allowed:
                        raise VaultError("连接方式设置无效")
                    settings[key] = patch[key]
            if "close_action" in patch:
                if patch["close_action"] not in ("tray", "quit"):
                    raise VaultError("关闭行为无效")
                settings["close_action"] = patch["close_action"]
            if "close_confirm" in patch:
                settings["close_confirm"] = bool(patch["close_confirm"])
            if "table_font" in patch:
                if patch["table_font"] not in ("mono", "sans"):
                    raise VaultError("表格字体无效")
                settings["table_font"] = patch["table_font"]
            if "ui_scale" in patch:
                if patch["ui_scale"] not in ("small", "standard", "large"):
                    raise VaultError("界面大小无效")
                settings["ui_scale"] = patch["ui_scale"]
            if "accent" in patch:
                if patch["accent"] not in ACCENTS:
                    raise VaultError("主题配色无效")
                settings["accent"] = patch["accent"]
            for font_key in ("ui_font", "code_font"):
                if font_key in patch:
                    settings[font_key] = _clean_font_name(patch[font_key])
            for flag in ("mask_usernames", "mask_addresses", "compact_rows"):
                if flag in patch:
                    settings[flag] = bool(patch[flag])
            self._save_settings(settings)
            return settings

    # -------------------------------------------------------------- lifecycle
    def _remaining_seconds(self) -> int | None:
        minutes = int(self.get_settings()["auto_lock_minutes"])
        if minutes <= 0:
            return None
        elapsed = time.monotonic() - self.last_activity
        return max(0, int(minutes * 60 - elapsed))

    def _check_auto_lock(self) -> None:
        if self.key is None:
            return
        remaining = self._remaining_seconds()
        if remaining is not None and remaining <= 0:
            self.lock("auto")
            log.info("Vault auto-locked after inactivity")

    def _ensure_unlocked(self) -> None:
        self._check_auto_lock()
        if self.key is None:
            raise VaultLocked("密码库已锁定，请重新输入打开密码")
        self.last_activity = time.monotonic()
        if not self._swept:
            self._swept = True
            try:
                self._encrypt_at_rest_sweep()
            except Exception:  # never block the UI on a migration
                log.exception("at-rest encryption sweep failed")

    def _set_key(self, dek: bytes) -> None:
        """Hold the DEK plus its password-tier subkey in memory only."""
        self.key = dek
        self.secret_key = derive_secret_key(dek)
        self._swept = False

    def touch(self) -> dict:
        with self._lock:
            if self.key is not None:
                self.last_activity = time.monotonic()
            return {
                "locked": self.key is None,
                "remaining_seconds": self._remaining_seconds(),
            }

    def heartbeat(self) -> dict:
        with self._lock:
            self._check_auto_lock()
            return {
                "locked": self.key is None,
                "remaining_seconds": self._remaining_seconds(),
            }

    def lock(self, reason: str = "manual") -> None:
        with self._lock:
            self.key = None
            self.secret_key = None
            self.pending_dek = None
            self._pending_recovery = None
            self.lock_reason = reason
        # Terminal sessions were opened with decrypted credentials, so they
        # must not outlive the vault being unlocked.
        try:
            from . import sessions

            sessions.close_all()
        except Exception:
            pass

    def get_state(self) -> dict:
        with self._lock:
            self._check_auto_lock()
            settings = self.get_settings()
            return {
                "initialized": self.has_master(),
                "locked": self.key is None,
                "lock_reason": self.lock_reason if self.key is None else None,
                "auto_lock_minutes": settings["auto_lock_minutes"],
                "remaining_seconds": self._remaining_seconds(),
                "theme": settings["theme"],
                "settings": settings,
                "recovery": self.recovery_status(),
                "version": __version__,
                "data_dir": str(data_dir()),
                "db_file": self.db_file,
                "vault_id": self._meta_get("vault_id"),
            }

    # --------------------------------------------------------------- password
    @staticmethod
    def validate_master_password(password: str) -> None:
        if not isinstance(password, str):
            raise VaultError("密码格式不正确")
        if len(password) < 8:
            raise VaultError("打开密码至少需要 8 位")
        if len(password) > 256:
            raise VaultError("打开密码过长")
        if password.strip() == "":
            raise VaultError("打开密码不能全部为空格")

    def initialize(self, password: str) -> dict:
        with self._lock:
            if self.has_master():
                raise VaultError("密码库已经初始化")
            self.validate_master_password(password)

            dek = new_dek()
            salt = new_salt()
            kek = derive_kek(password, salt)
            wrapped = wrap_dek(kek, dek)
            verifier = make_verifier(dek)
            vault_id = uuid.uuid4().hex
            created = now_text()

            self._meta_set("salt_master", b64e(salt))
            self._meta_set("iterations_master", str(KDF_ITERATIONS))
            self._meta_set("wrap_master", wrapped)
            self._meta_set("verifier", verifier)
            self._meta_set("vault_id", vault_id)
            self._meta_set("created_at", created)
            self._save_settings(self.get_settings())
            self.conn.commit()

            self._seed_default_pages()
            self._set_key(dek)
            self.lock_reason = None
            self.last_activity = time.monotonic()
            recovery = self._create_recovery(rotate=True)
            log.info("Vault initialized at %s", self.db_file)
            return {"recovery": recovery, "state": self.get_state()}

    def unlock(self, password: str) -> dict:
        with self._lock:
            if not self.has_master():
                raise VaultError("密码库尚未初始化")
            salt = b64d(self._meta_get("salt_master") or "")
            iterations = int(self._meta_get("iterations_master") or KDF_ITERATIONS)
            try:
                kek = derive_kek(password, salt, iterations)
                dek = unwrap_dek(kek, self._meta_get("wrap_master") or "")
            except CryptoError:
                raise VaultError("打开密码不正确")
            if not check_verifier(dek, self._meta_get("verifier") or ""):
                raise VaultError("打开密码不正确")
            self._set_key(dek)
            self.lock_reason = None
            self.pending_dek = None
            self.last_activity = time.monotonic()
            return {"state": self.get_state()}

    def change_master_password(self, old_password: str, new_password: str) -> dict:
        with self._lock:
            self._ensure_unlocked()
            salt = b64d(self._meta_get("salt_master") or "")
            iterations = int(self._meta_get("iterations_master") or KDF_ITERATIONS)
            try:
                old_kek = derive_kek(old_password, salt, iterations)
                old_dek = unwrap_dek(old_kek, self._meta_get("wrap_master") or "")
            except CryptoError:
                raise VaultError("当前打开密码不正确")
            if self.key is None or not hmac.compare_digest(old_dek, self.key):
                raise VaultError("当前打开密码不正确")
            self.validate_master_password(new_password)
            if old_password == new_password:
                raise VaultError("新密码不能与当前密码相同")
            fresh_salt = new_salt()
            new_kek = derive_kek(new_password, fresh_salt)
            self._meta_set("salt_master", b64e(fresh_salt))
            self._meta_set("iterations_master", str(KDF_ITERATIONS))
            self._meta_set("wrap_master", wrap_dek(new_kek, self.key))
            self.conn.commit()
            log.info("Master password changed")
            return {"ok": True}

    # --------------------------------------------------------------- recovery
    def recovery_status(self) -> dict:
        return {
            "enabled": bool(self._meta_get("wrap_recovery")),
            "created_at": self._meta_get("recovery_created_at"),
            "generation": int(self._meta_get("recovery_generation") or 0),
        }

    def _create_recovery(self, rotate: bool = False) -> dict:
        if self.key is None:
            raise VaultLocked("密码库已锁定")
        if self._meta_get("wrap_recovery") and not rotate:
            return {}
        code = new_recovery_code()
        salt = new_salt()
        generation = int(self._meta_get("recovery_generation") or 0) + 1
        wrapped = wrap_for_recovery(code, salt, self.key)
        created = now_text()
        self._meta_set("salt_recovery", b64e(salt))
        self._meta_set("iterations_recovery", str(KDF_ITERATIONS))
        self._meta_set("wrap_recovery", wrapped)
        self._meta_set("recovery_created_at", created)
        self._meta_set("recovery_generation", str(generation))
        self.conn.commit()
        payload = self._recovery_payload(code, salt, wrapped, generation, created)
        self._pending_recovery = payload
        return {
            "code": code,
            "created_at": created,
            "generation": generation,
            "filename": f"MedSafeVault-恢复密钥-{datetime.now().strftime('%Y%m%d')}.msvkey",
            "payload": payload,
        }

    def _recovery_payload(self, code: str, salt: bytes, wrapped: str,
                          generation: int, created: str) -> dict:
        return {
            "format": "MedSafeVault.RecoveryKey",
            "version": 1,
            "vault_id": self._meta_get("vault_id"),
            "created_at": created,
            "generation": generation,
            "recovery_code": code,
            "kdf": {
                "algorithm": KDF_ALGORITHM,
                "iterations": KDF_ITERATIONS,
                "salt": b64e(salt),
            },
            "wrapped_key": wrapped,
            "instructions": [
                "这是 MedSafeVault 的恢复密钥文件，等同于密码库的主钥匙。",
                "请离线保存（U 盘 / 纸质密码本），不要与数据库放在同一台电脑上。",
                "忘记打开密码时，在锁屏界面选择“恢复密钥文件”，导入本文件即可重设密码。",
                "重新生成恢复密钥后，本文件立即失效。",
            ],
        }

    def rotate_recovery(self) -> dict:
        with self._lock:
            self._ensure_unlocked()
            return self._create_recovery(rotate=True)

    def recovery_file_content(self) -> str:
        with self._lock:
            self._ensure_unlocked()
            if not self._pending_recovery:
                raise VaultError("请先在设置中重新生成恢复密钥")
            return json.dumps(self._pending_recovery, ensure_ascii=False, indent=2)

    def _validate_recovery_payload(self, payload: dict) -> bytes:
        if not isinstance(payload, dict):
            raise VaultError("恢复密钥文件格式不正确")
        if payload.get("format") != "MedSafeVault.RecoveryKey":
            raise VaultError("这不是 MedSafeVault 的恢复密钥文件")
        if int(payload.get("version") or 0) != 1:
            raise VaultError("恢复密钥文件版本不受支持")
        vault_id = self._meta_get("vault_id")
        if payload.get("vault_id") and vault_id and payload["vault_id"] != vault_id:
            raise VaultError("该恢复密钥文件不属于当前密码库")
        gen = int(payload.get("generation") or 0)
        stored_gen = int(self._meta_get("recovery_generation") or 0)
        if gen != stored_gen:
            raise VaultError("该恢复密钥已失效，请使用最新生成的文件")
        code = payload.get("recovery_code") or ""
        kdf = payload.get("kdf") or {}
        try:
            salt = b64d(kdf["salt"])
            iterations = int(kdf.get("iterations") or KDF_ITERATIONS)
        except Exception:
            raise VaultError("恢复密钥文件已损坏")
        if not (100_000 <= iterations <= 5_000_000):
            raise VaultError("恢复密钥文件参数异常")
        try:
            dek = unwrap_from_recovery(code, salt, payload.get("wrapped_key") or "", iterations)
        except CryptoError:
            raise VaultError("恢复密钥校验失败，文件可能已损坏")
        if not check_verifier(dek, self._meta_get("verifier") or ""):
            raise VaultError("恢复密钥与当前密码库不匹配")
        return dek

    def start_recovery_with_json(self, payload: dict) -> dict:
        with self._lock:
            dek = self._validate_recovery_payload(payload)
            self.pending_dek = dek
            self.lock_reason = "recovery"
            return {"ok": True, "vault_id": self._meta_get("vault_id")}

    def start_recovery_with_code(self, code: str) -> dict:
        with self._lock:
            try:
                normalized = normalize_recovery_code(code)
            except CryptoError as exc:
                raise VaultError(str(exc))
            salt = self._meta_get("salt_recovery")
            wrapped = self._meta_get("wrap_recovery")
            if not salt or not wrapped:
                raise VaultError("当前密码库未设置恢复密钥")
            iterations = int(self._meta_get("iterations_recovery") or KDF_ITERATIONS)
            try:
                dek = unwrap_from_recovery(
                    normalized, b64d(salt), wrapped, iterations
                )
            except CryptoError:
                raise VaultError("恢复密钥不正确")
            if not check_verifier(dek, self._meta_get("verifier") or ""):
                raise VaultError("恢复密钥与当前密码库不匹配")
            self.pending_dek = dek
            self.lock_reason = "recovery"
            return {"ok": True, "vault_id": self._meta_get("vault_id")}

    def finish_recovery(self, new_password: str) -> dict:
        with self._lock:
            if self.pending_dek is None:
                raise VaultError("恢复会话已失效，请重新导入恢复密钥文件")
            self.validate_master_password(new_password)
            salt = new_salt()
            kek = derive_kek(new_password, salt)
            wrapped = wrap_dek(kek, self.pending_dek)
            self._meta_set("salt_master", b64e(salt))
            self._meta_set("iterations_master", str(KDF_ITERATIONS))
            self._meta_set("wrap_master", wrapped)
            self.conn.commit()
            self._set_key(self.pending_dek)
            self.pending_dek = None
            self.lock_reason = None
            self.last_activity = time.monotonic()
            log.info("Master password reset through recovery key")
            return {"state": self.get_state()}

    def cancel_recovery(self) -> None:
        with self._lock:
            self.pending_dek = None
            self.lock_reason = None

    # ------------------------------------------------------------------ pages
    def _seed_default_pages(self) -> None:
        with self._lock:
            existing = self.conn.execute("SELECT COUNT(*) c FROM pages").fetchone()["c"]
            if existing:
                return
            for index, template_id in enumerate(DEFAULT_PAGE_IDS):
                self._insert_page_from_template(template_id, index)
            self.conn.commit()

    def _insert_page_from_template(self, template_id: str, sort_order: int) -> int:
        tpl = template_by_id(template_id)
        stamp = now_text()
        cur = self.conn.execute(
            "INSERT INTO pages(name,icon,description,sort_order,created_at,updated_at)"
            " VALUES(?,?,?,?,?,?)",
            (tpl["name"], tpl["icon"], tpl["description"], sort_order, stamp, stamp),
        )
        page_id = int(cur.lastrowid)
        for i, col in enumerate(tpl["columns"]):
            self.conn.execute(
                "INSERT INTO page_columns(page_id,key,label,type,encrypted,masked,frozen,width,"
                "visible,required,options,placeholder,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    page_id, col["key"], col["label"], col["type"],
                    1 if col["encrypted"] else 0, 1 if col["masked"] else 0,
                    1 if col.get("frozen") else 0,
                    int(col["width"]), 1 if col.get("visible", True) else 0,
                    1 if col.get("required") else 0, _json(col.get("options") or []),
                    col.get("placeholder") or "", i,
                ),
            )
        return page_id

    def _column_dict(self, row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "key": row["key"],
            "label": row["label"],
            "type": row["type"],
            "encrypted": bool(row["encrypted"]),
            # Derived, never stored: which ciphertext tier this column belongs to.
            "secret": row["type"] == "password",
            "masked": bool(row["masked"]),
            "frozen": bool(row["frozen"]),
            "width": row["width"],
            "visible": bool(row["visible"]),
            "required": bool(row["required"]),
            "options": _loads(row["options"], []),
            "placeholder": row["placeholder"] or "",
            "order": row["sort_order"],
        }

    def get_columns(self, page_id: int, include_hidden: bool = False) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM page_columns WHERE page_id=? ORDER BY sort_order,id", (page_id,)
        ).fetchall()
        cols = [self._column_dict(r) for r in rows]
        if not include_hidden:
            cols = [c for c in cols if c["visible"]]
        return cols

    def _page_dict(self, row: sqlite3.Row, with_columns: bool = True,
                   include_hidden: bool = True) -> dict:
        page = {
            "id": row["id"],
            "name": row["name"],
            "icon": row["icon"],
            "description": row["description"] or "",
            "sort_order": row["sort_order"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "deleted_at": row["deleted_at"],
        }
        if with_columns:
            page["columns"] = self.get_columns(row["id"], include_hidden=include_hidden)
            page["hidden_columns"] = len(self.get_columns(row["id"], include_hidden=True)) - len(page["columns"])
        return page

    def _page_row(self, page_id: int) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM pages WHERE id=?", (page_id,)).fetchone()
        if not row:
            raise VaultError("页面不存在")
        return row

    def get_pages(self) -> list[dict]:
        with self._lock:
            self._ensure_unlocked()
            rows = self.conn.execute(
                """
                SELECT p.*, (
                    SELECT COUNT(*) FROM records r
                    WHERE r.page_id=p.id AND r.deleted_at IS NULL
                ) AS record_count
                FROM pages p WHERE p.deleted_at IS NULL
                ORDER BY p.sort_order, p.id
                """
            ).fetchall()
            settings = self.get_settings()
            pages = []
            for row in rows:
                page = self._page_dict(row, with_columns=True, include_hidden=True)
                page["record_count"] = row["record_count"]
                page["columns"] = [
                    self._public_column(c, settings) for c in page["columns"]
                ]
                pages.append(page)
            return pages

    def _public_column(self, col: dict, settings: dict | None = None) -> dict:
        settings = settings or self.get_settings()
        out = dict(col)
        # Every column is sealed at rest; `secret` marks the stronger tier that
        # only password columns use (separate HKDF subkey and AAD).
        out["encrypted"] = True
        out["secret"] = col.get("type") == "password"
        if settings.get("mask_usernames") and (
            col["key"] in ("username", "oob_user") or col["label"] in ("用户名", "账号")
        ):
            out["masked"] = True
        if settings.get("mask_addresses") and col["key"] in ("address", "oob"):
            out["masked"] = True
        return out

    def get_page_templates(self) -> list[dict]:
        return [
            {
                "id": tpl["id"],
                "name": tpl["name"],
                "icon": tpl["icon"],
                "description": tpl["description"],
                "columns": [dict(c) for c in tpl["columns"]],
            }
            for tpl in PAGE_TEMPLATES
        ]

    def _validate_page(self, payload: dict, page_id: int | None = None) -> dict:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise VaultError("页面名称不能为空")
        if len(name) > 24:
            raise VaultError("页面名称不能超过 24 个字符")
        if page_id is None:
            dup = self.conn.execute(
                "SELECT 1 FROM pages WHERE deleted_at IS NULL AND lower(name)=lower(?)",
                (name,),
            ).fetchone()
            if dup:
                raise VaultError("已存在同名页面")
        else:
            dup = self.conn.execute(
                "SELECT 1 FROM pages WHERE deleted_at IS NULL AND lower(name)=lower(?) AND id<>?",
                (name, page_id),
            ).fetchone()
            if dup:
                raise VaultError("已存在同名页面")
        icon = str(payload.get("icon") or "grid")
        if icon not in ICONS:
            icon = "grid"
        description = str(payload.get("description") or "").strip()[:80]
        columns = payload.get("columns")
        if columns is None:
            columns = []
        if not isinstance(columns, list):
            raise VaultError("列配置格式不正确")
        if len(columns) > 40:
            raise VaultError("单个页面的列不能超过 40 个")
        cleaned: list[dict] = []
        labels: set[str] = set()
        keys: set[str] = set()
        for spec in columns:
            if not isinstance(spec, dict):
                continue
            label = str(spec.get("label") or "").strip()
            if not label:
                raise VaultError("列名称不能为空")
            if len(label) > 24:
                raise VaultError("列名称不能超过 24 个字符")
            if label in labels:
                raise VaultError(f"列名称「{label}」重复")
            labels.add(label)
            type_ = str(spec.get("type") or "text")
            if type_ not in COLUMN_TYPES:
                type_ = "text"
            key = str(spec.get("key") or "").strip()
            if key and not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]{0,40}", key):
                key = ""
            if key and key in keys:
                key = ""
            if not key:
                key = _slug_key(keys)
            keys.add(key)
            try:
                width = int(spec.get("width") or 160)
            except Exception:
                width = 160
            width = max(80, min(width, 600))
            # Every value is sealed at rest now; the flag only records that the
            # column exists in the encrypted layout (kept for older backups).
            encrypted = True
            masked = bool(spec.get("masked")) or type_ == "password"
            options = spec.get("options") or []
            if not isinstance(options, list):
                options = []
            options = [str(o).strip() for o in options if str(o).strip()][:50]
            frozen = bool(spec.get("frozen")) and all(c["frozen"] for c in cleaned)
            cleaned.append({
                "id": spec.get("id") if isinstance(spec.get("id"), int) else None,
                "key": key,
                "label": label,
                "type": type_,
                "encrypted": encrypted,
                "masked": masked,
                "frozen": frozen,
                "width": width,
                "visible": bool(spec.get("visible", True)),
                "required": bool(spec.get("required", False)),
                "options": options,
                "placeholder": str(spec.get("placeholder") or "")[:60],
            })
        if not cleaned:
            raise VaultError("页面至少需要一列")
        return {"name": name, "icon": icon, "description": description, "columns": cleaned}

    def create_page(self, payload: dict) -> dict:
        with self._lock:
            self._ensure_unlocked()
            data = self._validate_page(payload)
            stamp = now_text()
            max_order = self.conn.execute(
                "SELECT COALESCE(MAX(sort_order),-1) m FROM pages"
            ).fetchone()["m"]
            with self.conn:
                cur = self.conn.execute(
                    "INSERT INTO pages(name,icon,description,sort_order,created_at,updated_at)"
                    " VALUES(?,?,?,?,?,?)",
                    (data["name"], data["icon"], data["description"],
                     max_order + 1, stamp, stamp),
                )
                page_id = int(cur.lastrowid)
                for i, col in enumerate(data["columns"]):
                    self.conn.execute(
                        "INSERT INTO page_columns(page_id,key,label,type,encrypted,masked,"
                        "frozen,width,visible,required,options,placeholder,sort_order)"
                        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (
                            page_id, col["key"], col["label"], col["type"],
                            1 if col["encrypted"] else 0, 1 if col["masked"] else 0,
                            1 if col["frozen"] else 0,
                            col["width"], 1 if col["visible"] else 0,
                            1 if col["required"] else 0, _json(col["options"]),
                            col["placeholder"], i,
                        ),
                    )
                after = self._page_snapshot(page_id)
                self._log("create_page", "page", page_id, page_id,
                          f"新建页面「{data['name']}」", None, after)
            return self._page_dict(self._page_row(page_id))

    def update_page(self, page_id: int, payload: dict) -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self._page_row(page_id)
            if row["deleted_at"]:
                raise VaultError("页面在回收站中，请先恢复")
            data = self._validate_page(payload, page_id=page_id)
            before = self._page_snapshot(page_id)
            old_name = row["name"]
            existing = {
                r["id"]: r for r in self.conn.execute(
                    "SELECT * FROM page_columns WHERE page_id=?", (page_id,)
                ).fetchall()
            }
            used_keys = {r["key"] for r in existing.values()}
            kept: set[int] = set()
            stamp = now_text()
            with self.conn:
                self.conn.execute(
                    "UPDATE pages SET name=?,icon=?,description=?,updated_at=? WHERE id=?",
                    (data["name"], data["icon"], data["description"], stamp, page_id),
                )
                for i, col in enumerate(data["columns"]):
                    cid = col.get("id")
                    if cid and cid in existing:
                        self.conn.execute(
                            "UPDATE page_columns SET label=?,type=?,encrypted=?,masked=?,"
                            "frozen=?,width=?,visible=?,required=?,options=?,placeholder=?,"
                            "sort_order=? WHERE id=? AND page_id=?",
                            (
                                col["label"], col["type"],
                                1 if col["encrypted"] else 0,
                                1 if col["masked"] else 0,
                                1 if col["frozen"] else 0,
                                col["width"], 1 if col["visible"] else 0,
                                1 if col["required"] else 0, _json(col["options"]),
                                col["placeholder"], i, cid, page_id,
                            ),
                        )
                        kept.add(cid)
                    else:
                        key = col["key"]
                        if not key or key in used_keys:
                            key = _slug_key(used_keys)
                        used_keys.add(key)
                        self.conn.execute(
                            "INSERT INTO page_columns(page_id,key,label,type,encrypted,masked,"
                            "frozen,width,visible,required,options,placeholder,sort_order)"
                            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                            (
                                page_id, key, col["label"], col["type"],
                                1 if col["encrypted"] else 0,
                                1 if col["masked"] else 0,
                                1 if col["frozen"] else 0,
                                col["width"], 1 if col["visible"] else 0,
                                1 if col["required"] else 0, _json(col["options"]),
                                col["placeholder"], i,
                            ),
                        )
                if kept:
                    placeholders = ",".join("?" for _ in kept)
                    self.conn.execute(
                        f"DELETE FROM page_columns WHERE page_id=? AND id NOT IN ({placeholders})",
                        (page_id, *kept),
                    )
                else:
                    self.conn.execute("DELETE FROM page_columns WHERE page_id=?", (page_id,))
                after = self._page_snapshot(page_id)
                title = f"修改页面「{data['name']}」"
                if old_name != data["name"]:
                    title = f"修改页面「{old_name}」→「{data['name']}」"
                self._log("update_page", "page", page_id, page_id, title, before, after)
            return self._page_dict(self._page_row(page_id))

    def delete_page(self, page_id: int) -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self._page_row(page_id)
            if row["deleted_at"]:
                raise VaultError("页面已在回收站中")
            before = self._page_snapshot(page_id)
            stamp = now_text()
            with self.conn:
                self.conn.execute(
                    "UPDATE pages SET deleted_at=?,updated_at=? WHERE id=?",
                    (stamp, stamp, page_id),
                )
                after = self._page_snapshot(page_id)
                self._log("delete_page", "page", page_id, page_id,
                          f"删除页面「{row['name']}」", before, after)
            return {"ok": True, "recycle_id": page_id}

    def _page_snapshot(self, page_id: int) -> dict:
        row = self._page_row(page_id)
        return {
            "page": dict(row),
            "columns": [
                dict(r) for r in self.conn.execute(
                    "SELECT * FROM page_columns WHERE page_id=? ORDER BY sort_order,id",
                    (page_id,),
                ).fetchall()
            ],
        }

    def _hard_delete_page(self, page_id: int) -> None:
        self.conn.execute("DELETE FROM pages WHERE id=?", (page_id,))

    def _insert_page_snapshot(self, snap: dict) -> None:
        page = snap.get("page") or {}
        if not page:
            return
        self.conn.execute(
            "INSERT OR REPLACE INTO pages(id,name,icon,description,sort_order,created_at,"
            "updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?)",
            (
                page["id"], page["name"], page.get("icon") or "grid",
                page.get("description") or "", int(page.get("sort_order") or 0),
                page.get("created_at") or now_text(), page.get("updated_at") or now_text(),
                page.get("deleted_at"),
            ),
        )
        self.conn.execute("DELETE FROM page_columns WHERE page_id=?", (page["id"],))
        for col in snap.get("columns") or []:
            self.conn.execute(
                "INSERT INTO page_columns(id,page_id,key,label,type,encrypted,masked,frozen,width,"
                "visible,required,options,placeholder,sort_order)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    col["id"], page["id"], col["key"], col["label"], col["type"],
                    int(col.get("encrypted") or 0), int(col.get("masked") or 0),
                    int(col.get("frozen") or 0),
                    int(col.get("width") or 160), int(col.get("visible", 1)),
                    int(col.get("required") or 0), col.get("options") or "[]",
                    col.get("placeholder") or "", int(col.get("sort_order") or 0),
                ),
            )

    # ---------------------------------------------------------------- records
    def _cols_for_page(self, page_id: int) -> list[dict]:
        return self.get_columns(page_id, include_hidden=True)

    def _pack_values(self, cols: Iterable[dict], values: dict) -> dict:
        """Seal every field: ordinary columns with the DEK, passwords with the
        derived password-tier subkey."""
        assert self.key is not None
        data: dict[str, Any] = {}
        for col in cols:
            key = col["key"]
            raw = values.get(key, "")
            if raw is None:
                raw = ""
            text = str(raw)
            if text == "":
                continue
            data[key] = {
                "e": seal_field(self.key, self.secret_key, text, self._is_secret_col(col))
            }
        return data

    @staticmethod
    def _is_secret_col(col: dict) -> bool:
        return col.get("type") == "password"

    @staticmethod
    def _token_of(raw: Any) -> Any:
        if isinstance(raw, dict):
            return raw.get("e")
        return raw

    def _plain(self, raw: Any) -> str:
        token = self._token_of(raw)
        if token is None:
            return ""
        if not isinstance(token, str):
            return str(token)
        if not token:
            return ""
        if token_prefix(token) is None:
            # Rows written before global encryption stayed as plain text; they
            # remain readable and are re-sealed by the at-rest sweep.
            return token
        if self.key is None:
            return ""
        try:
            return open_field(self.key, self.secret_key, token)
        except CryptoError:
            return ""

    def _reseal(self, data: dict, cols: list[dict]) -> tuple[dict, bool]:
        """Return `data` with any plaintext value encrypted."""
        by_key = {c["key"]: c for c in cols}
        out = dict(data)
        changed = False
        for key, raw in list(data.items()):
            token = self._token_of(raw)
            if isinstance(token, str) and token_prefix(token):
                continue
            text = self._plain(raw)
            if text == "":
                continue
            col = by_key.get(key) or {"key": key, "type": "text"}
            out[key] = {
                "e": seal_field(self.key, self.secret_key, text, self._is_secret_col(col))
            }
            changed = True
        return out, changed

    def _encrypt_at_rest_sweep(self) -> int:
        """One-off migration: everything the user already stored becomes a
        ciphertext row, passwords moving to the stronger tier."""
        if self.key is None:
            return 0
        cols_cache: dict[int, list[dict]] = {}

        def cols_for(page_id: int) -> list[dict]:
            if page_id not in cols_cache:
                try:
                    cols_cache[page_id] = self._cols_for_page(page_id)
                except VaultError:
                    cols_cache[page_id] = []
            return cols_cache[page_id]

        touched = 0
        for row in self.conn.execute("SELECT id, page_id, data FROM records").fetchall():
            data = _loads(row["data"], {})
            if not isinstance(data, dict) or not data:
                continue
            packed, changed = self._reseal(data, cols_for(row["page_id"]))
            if changed:
                self.conn.execute("UPDATE records SET data=? WHERE id=?", (_json(packed), row["id"]))
                touched += 1
        for row in self.conn.execute(
            "SELECT id, page_id, before, after FROM history WHERE page_id IS NOT NULL"
        ).fetchall():
            sets: dict[str, str] = {}
            for name in ("before", "after"):
                raw = row[name]
                if not raw:
                    continue
                blob = _loads(raw, None)
                if not isinstance(blob, dict) or not isinstance(blob.get("data"), dict):
                    continue
                packed, changed = self._reseal(blob["data"], cols_for(row["page_id"]))
                if changed:
                    blob["data"] = packed
                    sets[name] = _json(blob)
            if sets:
                assignments = ", ".join(f"{name}=?" for name in sets)
                self.conn.execute(
                    f"UPDATE history SET {assignments} WHERE id=?",
                    (*sets.values(), row["id"]),
                )
                touched += 1
        if touched:
            self.conn.commit()
            log.info("Re-encrypted %s stored rows", touched)
        return touched

    def _decrypt_data(self, data: dict, cols: Iterable[dict] | None = None) -> dict:
        cols = list(cols or [])
        keys = {c["key"] for c in cols}
        if not keys:
            keys = set(data.keys())
        out = {}
        for key in keys:
            out[key] = self._plain(data.get(key, ""))
        return out

    def _record_title(self, data: dict, cols: Iterable[dict]) -> str:
        plain = {}
        for key, raw in data.items():
            plain[key] = self._plain(raw)
        for key in ("app", "name", "title", "address", "host"):
            value = (plain.get(key) or "").strip()
            if value:
                return value
        for col in cols:
            value = (plain.get(col["key"]) or "").strip()
            if value and not col["masked"]:
                return value
        return "未命名记录"

    def _record_snapshot(self, record_id: int) -> dict | None:
        row = self.conn.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "page_id": row["page_id"],
            "data": _loads(row["data"], {}),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "deleted_at": row["deleted_at"],
        }

    def _apply_record_snapshot(self, snap: dict) -> None:
        if not snap:
            return
        self.conn.execute(
            "INSERT OR REPLACE INTO records(id,page_id,data,created_at,updated_at,deleted_at)"
            " VALUES(?,?,?,?,?,?)",
            (
                snap["id"], snap["page_id"], _json(snap.get("data") or {}),
                snap.get("created_at") or now_text(),
                snap.get("updated_at") or now_text(), snap.get("deleted_at"),
            ),
        )

    def _present_record(self, row: sqlite3.Row, cols: list[dict],
                        settings: dict | None = None) -> dict:
        settings = settings or self.get_settings()
        data = _loads(row["data"], {})
        cells: dict[str, dict] = {}
        for col in cols:
            if not col["visible"]:
                continue
            col = self._public_column(col, settings)
            raw = data.get(col["key"])
            has = bool(raw) and (not isinstance(raw, dict) or bool(raw.get("e")))
            if col["masked"]:
                cells[col["key"]] = {"value": MASK if has else "", "masked": True, "has": has}
            else:
                cells[col["key"]] = {"value": self._plain(raw), "masked": False, "has": has}
        return {
            "id": row["id"],
            "page_id": row["page_id"],
            "title": self._record_title(data, cols),
            "cells": cells,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "deleted_at": row["deleted_at"],
        }

    def list_records(self, page_id: int, query: str = "", offset: int = 0,
                     limit: int = 50, sort_key: str | None = None,
                     sort_dir: str = "asc") -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self._page_row(page_id)
            if row["deleted_at"]:
                raise VaultError("页面在回收站中，请先恢复")
            cols = self._cols_for_page(page_id)
            rows = self.conn.execute(
                "SELECT * FROM records WHERE page_id=? AND deleted_at IS NULL"
                " ORDER BY id ASC",
                (page_id,),
            ).fetchall()
            needle = (query or "").strip().lower()
            prepared: list[tuple[sqlite3.Row, dict]] = []
            for r in rows:
                data = _loads(r["data"], {})
                plain = self._decrypt_data(data, cols)
                if needle:
                    haystack = " ".join(
                        [self._record_title(data, cols)]
                        + [str(v) for v in plain.values()]
                    ).lower()
                    if needle not in haystack:
                        continue
                prepared.append((r, plain))

            if sort_key:
                reverse = (sort_dir or "asc").lower() == "desc"

                def sort_value(item: tuple[sqlite3.Row, dict]) -> str:
                    value = item[1].get(sort_key, "")
                    return str(value).lower()

                prepared.sort(key=sort_value, reverse=reverse)

            total = len(prepared)
            limit = max(1, min(int(limit or 50), 200))
            offset = max(0, int(offset or 0))
            page_rows = prepared[offset:offset + limit]
            settings = self.get_settings()
            items = []
            for r, _plain in page_rows:
                items.append(self._present_record(r, cols, settings))
            return {
                "page": {
                    "id": row["id"],
                    "name": row["name"],
                    "icon": row["icon"],
                    "description": row["description"] or "",
                },
                "columns": [self._public_column(c, settings) for c in cols if c["visible"]],
                "rows": items,
                "total": total,
                "offset": offset,
                "limit": limit,
            }

    def get_record(self, record_id: int) -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self.conn.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone()
            if not row:
                raise VaultError("记录不存在")
            page = self._page_row(row["page_id"])
            cols = self._cols_for_page(row["page_id"])
            data = _loads(row["data"], {})
            values = self._decrypt_data(data, cols)
            values["connect_mode"] = data.get("connect_mode") or "auto"
            return {
                "id": row["id"],
                "page_id": row["page_id"],
                "page_name": page["name"],
                "values": values,
                "columns": [self._public_column(c) for c in cols],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }

    def suggest_values(self, page_id: int, key: str, query: str = "",
                       limit: int = 10) -> dict:
        """Distinct recent values of one column, used for input suggestions.
        Password-tier columns never leak through here."""
        with self._lock:
            self._ensure_unlocked()
            page = self._page_row(page_id)
            if page["deleted_at"]:
                raise VaultError("页面在回收站中，请先恢复")
            cols = self._cols_for_page(page_id)
            col = next((c for c in cols if c["key"] == key), None)
            if col is None:
                raise VaultError("字段不存在")
            if self._is_secret_col(col):
                return {"values": []}
            try:
                wanted = max(1, min(int(limit or 10), 30))
            except Exception:
                wanted = 10
            needle = (query or "").strip().lower()
            rows = self.conn.execute(
                "SELECT data FROM records WHERE page_id=? AND deleted_at IS NULL"
                " ORDER BY updated_at DESC, id DESC LIMIT 600",
                (page_id,),
            ).fetchall()
            values: list[str] = []
            seen: set[str] = set()
            for row in rows:
                data = _loads(row["data"], {})
                text = self._plain(data.get(key, "")).strip()
                if not text:
                    continue
                low = text.lower()
                if needle and needle not in low:
                    continue
                if low in seen:
                    continue
                seen.add(low)
                values.append(text)
                if len(values) >= wanted:
                    break
            return {"values": values}

    def save_record(self, page_id: int, values: dict, record_id: int | None = None) -> dict:
        with self._lock:
            self._ensure_unlocked()
            page = self._page_row(page_id)
            if page["deleted_at"]:
                raise VaultError("页面在回收站中，请先恢复")
            cols = self._cols_for_page(page_id)
            by_key = {c["key"]: c for c in cols}
            clean = {}
            for col in cols:
                if col["key"] in values:
                    clean[col["key"]] = "" if values[col["key"]] is None else str(values[col["key"]])
            for col in cols:
                if col.get("required") and not (clean.get(col["key"]) or "").strip():
                    raise VaultError(f"「{col['label']}」不能为空")
            mode = str(values.get("connect_mode") or "auto").strip().lower()
            if mode not in CONNECT_MODES:
                mode = "auto"
            data = self._pack_values(cols, clean)
            # How to reach this row (SSH/RDP/...), independent of the page columns.
            data["connect_mode"] = mode
            stamp = now_text()
            with self.conn:
                if record_id:
                    old = self.conn.execute(
                        "SELECT * FROM records WHERE id=?", (record_id,)
                    ).fetchone()
                    if not old:
                        raise VaultError("记录不存在")
                    if old["page_id"] != page_id:
                        raise VaultError("记录不属于当前页面")
                    before = self._record_snapshot(record_id)
                    if _loads(old["data"], {}) != data:
                        self.conn.execute(
                            "UPDATE records SET data=?,updated_at=? WHERE id=?",
                            (_json(data), stamp, record_id),
                        )
                        after = self._record_snapshot(record_id)
                        title = f"修改记录「{self._record_title(data, cols)}」"
                        self._log("update_record", "record", record_id, page_id,
                                  title, before, after)
                    else:
                        after = before
                else:
                    cur = self.conn.execute(
                        "INSERT INTO records(page_id,data,created_at,updated_at)"
                        " VALUES(?,?,?,?)",
                        (page_id, _json(data), stamp, stamp),
                    )
                    record_id = int(cur.lastrowid)
                    after = self._record_snapshot(record_id)
                    self._log("create_record", "record", record_id, page_id,
                              f"新增记录「{self._record_title(data, cols)}」", None, after)
            return {"record": after, "page_id": page_id}

    def delete_record(self, record_id: int, hard: bool = False) -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self.conn.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone()
            if not row:
                raise VaultError("记录不存在")
            page = self._page_row(row["page_id"])
            cols = self._cols_for_page(row["page_id"])
            data = _loads(row["data"], {})
            title = self._record_title(data, cols)
            stamp = now_text()
            if hard:
                with self.conn:
                    self.conn.execute("DELETE FROM records WHERE id=?", (record_id,))
                    self._log("purge_record", "record", record_id, row["page_id"],
                              f"彻底删除记录「{title}」", None, None, undoable=0)
                return {"ok": True}
            if row["deleted_at"]:
                raise VaultError("记录已在回收站中")
            before = self._record_snapshot(record_id)
            with self.conn:
                self.conn.execute(
                    "UPDATE records SET deleted_at=?,updated_at=? WHERE id=?",
                    (stamp, stamp, record_id),
                )
                after = self._record_snapshot(record_id)
                self._log("delete_record", "record", record_id, row["page_id"],
                          f"删除记录「{title}」", before, after)
            return {"ok": True, "record_id": record_id, "page_id": row["page_id"]}

    def delete_records(self, record_ids: list[int]) -> dict:
        """Move several records to the recycle bin; each keeps its own undo."""
        ids: list[int] = []
        for raw in record_ids or []:
            try:
                ids.append(int(raw))
            except Exception:
                continue
        if not ids:
            raise VaultError("没有选中的记录")
        moved: list[int] = []
        skipped = 0
        with self._lock:
            self._ensure_unlocked()
            for rid in ids:
                try:
                    self.delete_record(rid)
                    moved.append(rid)
                except VaultError:
                    skipped += 1
        if not moved:
            raise VaultError("选中的记录无法移入回收站")
        return {"ok": True, "moved": moved, "skipped": skipped}

    def reveal_secret(self, record_id: int, column_key: str) -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self.conn.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone()
            if not row:
                raise VaultError("记录不存在")
            if row["deleted_at"]:
                raise VaultError("记录在回收站中")
            cols = {c["key"]: c for c in self._cols_for_page(row["page_id"])}
            col = cols.get(column_key)
            if not col:
                raise VaultError("字段不存在")
            data = _loads(row["data"], {})
            return {"value": self._plain(data.get(column_key, ""))}

    def generate_password(self, length: int = 18, symbols: bool = True) -> dict:
        value = random_password(length, symbols)
        return {"value": value, "score": password_score(value)}

    # ---------------------------------------------------------------- history
    def _log(self, action: str, entity: str, entity_id: int | None, page_id: int | None,
             title: str, before: dict | None, after: dict | None,
             undoable: bool = True) -> None:
        # A brand new action invalidates the redo branch.
        self.conn.execute("UPDATE history SET state=? WHERE state=?", (HISTORY_DISCARDED, HISTORY_UNDONE))
        self.conn.execute(
            "INSERT INTO history(action,entity,entity_id,page_id,title,before,after,"
            "created_at,state,undoable) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                action, entity, entity_id, page_id, title,
                _json(before) if before is not None else None,
                _json(after) if after is not None else None,
                now_text(), HISTORY_APPLIED, 1 if undoable else 0,
            ),
        )

    def _history_page_name(self, page_id: int | None) -> str:
        if not page_id:
            return ""
        row = self.conn.execute("SELECT name FROM pages WHERE id=?", (page_id,)).fetchone()
        return row["name"] if row else "已删除页面"

    def _diff_record(self, before: dict | None, after: dict | None, page_id: int,
                     cols: list[dict]) -> list[dict]:
        if not cols:
            cols = self.get_columns(page_id, include_hidden=True)
        by_key = {c["key"]: c for c in cols}
        before_data = (before or {}).get("data") or {}
        after_data = (after or {}).get("data") or {}
        keys: list[str] = []
        for key in list(before_data.keys()) + list(after_data.keys()):
            if key not in keys:
                keys.append(key)
        changes = []
        settings = self.get_settings()
        if before is not None and after is not None:
            was_deleted = bool(before.get("deleted_at"))
            is_deleted = bool(after.get("deleted_at"))
            if was_deleted != is_deleted:
                changes.append({
                    "key": "__status", "label": "状态", "masked": False, "secret": False,
                    "before": "回收站" if was_deleted else "使用中",
                    "after": "回收站" if is_deleted else "使用中",
                    "has_before": True, "has_after": True,
                })
        for key in keys:
            col = by_key.get(key) or {
                "key": key, "label": key, "masked": False, "encrypted": False,
            }
            col = self._public_column(col, settings)
            raw_b = before_data.get(key)
            raw_a = after_data.get(key)
            plain_b = self._plain(raw_b)
            plain_a = self._plain(raw_a)
            if plain_b == plain_a:
                continue
            secret = is_secret_token(self._token_of(raw_b)) or is_secret_token(
                self._token_of(raw_a)
            )
            mask = bool(col["masked"]) or bool(
                settings.get("mask_usernames") and key in ("username", "oob_user")
            )
            changes.append({
                "key": key,
                "label": col["label"],
                "masked": bool(mask),
                "before": MASK if (mask and plain_b) else ("" if mask else plain_b),
                "after": MASK if (mask and plain_a) else ("" if mask else plain_a),
                "has_before": bool(plain_b),
                "has_after": bool(plain_a),
                "secret": bool(secret),
            })
        return changes

    def _diff_page(self, before: dict | None, after: dict | None) -> list[dict]:
        bpage = (before or {}).get("page") or {}
        apage = (after or {}).get("page") or {}
        changes = []
        for key, label in (("name", "页面名称"), ("icon", "图标"), ("description", "描述")):
            if (bpage.get(key) or "") != (apage.get(key) or ""):
                changes.append({
                    "key": key, "label": label, "masked": False, "secret": False,
                    "before": bpage.get(key) or "", "after": apage.get(key) or "",
                    "has_before": bool(bpage.get(key)), "has_after": bool(apage.get(key)),
                })
        if before is not None and after is not None:
            was_deleted = bool(bpage.get("deleted_at"))
            is_deleted = bool(apage.get("deleted_at"))
            if was_deleted != is_deleted:
                changes.append({
                    "key": "status", "label": "状态", "masked": False, "secret": False,
                    "before": "回收站" if was_deleted else "使用中",
                    "after": "回收站" if is_deleted else "使用中",
                    "has_before": True, "has_after": True,
                })
        bcols = (before or {}).get("columns") or []
        acols = (after or {}).get("columns") or []
        blabels = [c.get("label", "") for c in bcols]
        alabels = [c.get("label", "") for c in acols]
        if blabels != alabels:
            changes.append({
                "key": "columns", "label": "列配置", "masked": False, "secret": False,
                "before": f"{len(blabels)} 列：" + "、".join(blabels),
                "after": f"{len(alabels)} 列：" + "、".join(alabels),
                "has_before": True, "has_after": True,
            })
        return changes

    def get_history(self, offset: int = 0, limit: int = 40,
                    kind: str = "all", query: str = "") -> dict:
        with self._lock:
            self._ensure_unlocked()
            clauses = []
            params: list[Any] = []
            if kind in ("record", "page"):
                clauses.append("entity=?")
                params.append(kind)
            if query.strip():
                clauses.append("title LIKE ?")
                params.append(f"%{query.strip()}%")
            where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
            total = self.conn.execute(
                f"SELECT COUNT(*) c FROM history{where}", tuple(params)
            ).fetchone()["c"]
            limit = max(1, min(int(limit or 40), 200))
            offset = max(0, int(offset or 0))
            rows = self.conn.execute(
                f"SELECT * FROM history{where} ORDER BY id DESC LIMIT ? OFFSET ?",
                (*params, limit, offset),
            ).fetchall()
            undo_row = self.conn.execute(
                "SELECT id FROM history WHERE state=? AND undoable=1 ORDER BY id DESC LIMIT 1",
                (HISTORY_APPLIED,),
            ).fetchone()
            undoable_id = undo_row["id"] if undo_row else None
            items = []
            for row in rows:
                before = _loads(row["before"], None)
                after = _loads(row["after"], None)
                cols: list[dict] = []
                page_id = row["page_id"]
                if row["entity"] == "record" and page_id:
                    cols = self.get_columns(page_id, include_hidden=True)
                action = row["action"]
                if row["entity"] == "record":
                    if action == "delete_record":
                        changes = self._diff_record(before, None, page_id, cols)
                    elif action == "restore_record":
                        changes = self._diff_record(None, after, page_id, cols)
                    elif action == "import_records":
                        records = (after or {}).get("records") or []
                        changes = [{
                            "key": "__import", "label": "导入记录",
                            "masked": False, "secret": False,
                            "before": "", "after": f"{len(records)} 条记录",
                            "has_before": False, "has_after": True,
                        }] if records else []
                    else:
                        changes = self._diff_record(before, after, page_id, cols)
                elif row["entity"] == "page":
                    changes = self._diff_page(before, after)
                else:
                    changes = []
                items.append({
                    "id": row["id"],
                    "action": row["action"],
                    "entity": row["entity"],
                    "entity_id": row["entity_id"],
                    "page_id": page_id,
                    "page_name": self._history_page_name(page_id),
                    "title": row["title"],
                    "created_at": row["created_at"],
                    "state": row["state"],
                    "undoable": bool(row["undoable"]),
                    "can_undo": bool(row["undoable"]) and row["state"] == HISTORY_APPLIED and row["id"] == undoable_id,
                    "changes": changes,
                })
            return {
                "items": items,
                "total": total,
                "undoable_id": undoable_id,
                "undo_state": self._undo_state(),
            }

    def _undo_state(self) -> dict:
        undo_row = self.conn.execute(
            "SELECT id,title FROM history WHERE state=? AND undoable=1 ORDER BY id DESC LIMIT 1",
            (HISTORY_APPLIED,),
        ).fetchone()
        redo_row = self.conn.execute(
            "SELECT id,title FROM history WHERE state=? ORDER BY id ASC LIMIT 1",
            (HISTORY_UNDONE,),
        ).fetchone()
        return {
            "can_undo": undo_row is not None,
            "can_redo": redo_row is not None,
            "undo": {"id": undo_row["id"], "title": undo_row["title"]} if undo_row else None,
            "redo": {"id": redo_row["id"], "title": redo_row["title"]} if redo_row else None,
        }

    def reveal_history(self, history_id: int, side: str, key: str) -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self.conn.execute("SELECT * FROM history WHERE id=?", (history_id,)).fetchone()
            if not row:
                raise VaultError("历史记录不存在")
            if side not in ("before", "after"):
                raise VaultError("参数无效")
            snap = _loads(row[side], None)
            if not snap or row["entity"] != "record":
                raise VaultError("该记录没有可查看的字段")
            data = snap.get("data") or {}
            return {"value": self._plain(data.get(key, ""))}

    def _inverse(self, row: sqlite3.Row) -> None:
        action = row["action"]
        before = _loads(row["before"], None)
        after = _loads(row["after"], None)
        if action in ("create_record",):
            if after:
                self.conn.execute("DELETE FROM records WHERE id=?", (after["id"],))
        elif action == "import_records":
            for snap in (after or {}).get("records") or []:
                self.conn.execute("DELETE FROM records WHERE id=?", (snap["id"],))
        elif action == "update_record":
            if before:
                self._apply_record_snapshot(before)
        elif action == "delete_record":
            if before:
                self._apply_record_snapshot(before)
        elif action == "restore_record":
            if before:
                self._apply_record_snapshot(before)
        elif action == "create_page":
            if after:
                self._hard_delete_page(after["page"]["id"])
        elif action == "update_page":
            if before:
                self._insert_page_snapshot(before)
        elif action == "delete_page":
            if before:
                self._insert_page_snapshot(before)
        elif action == "restore_page":
            if before:
                self._insert_page_snapshot(before)
        elif action in ("purge_record", "purge_page"):
            raise VaultError("彻底删除的操作无法撤回")
        else:
            raise VaultError("该操作类型不支持撤回")

    def _forward(self, row: sqlite3.Row) -> None:
        action = row["action"]
        before = _loads(row["before"], None)
        after = _loads(row["after"], None)
        if action == "create_record":
            if after:
                self._apply_record_snapshot(after)
        elif action == "import_records":
            for snap in (after or {}).get("records") or []:
                self._apply_record_snapshot(snap)
        elif action == "update_record":
            if after:
                self._apply_record_snapshot(after)
        elif action == "delete_record":
            if after:
                self._apply_record_snapshot(after)
        elif action == "restore_record":
            if after:
                self._apply_record_snapshot(after)
        elif action == "create_page":
            if after:
                self._insert_page_snapshot(after)
        elif action == "update_page":
            if after:
                self._insert_page_snapshot(after)
        elif action == "delete_page":
            if after:
                self._insert_page_snapshot(after)
        elif action == "restore_page":
            if after:
                self._insert_page_snapshot(after)
        else:
            raise VaultError("该操作类型不支持重做")

    def undo(self) -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self.conn.execute(
                "SELECT * FROM history WHERE state=? AND undoable=1 ORDER BY id DESC LIMIT 1",
                (HISTORY_APPLIED,),
            ).fetchone()
            if not row:
                raise VaultError("没有可以撤回的操作")
            with self.conn:
                self._inverse(row)
                self.conn.execute(
                    "UPDATE history SET state=? WHERE id=?", (HISTORY_UNDONE, row["id"])
                )
            return {"ok": True, "message": f"已撤回：{row['title']}", "undo_state": self._undo_state()}

    def redo(self) -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self.conn.execute(
                "SELECT * FROM history WHERE state=? ORDER BY id ASC LIMIT 1",
                (HISTORY_UNDONE,),
            ).fetchone()
            if not row:
                raise VaultError("没有可以恢复的操作")
            with self.conn:
                self._forward(row)
                self.conn.execute(
                    "UPDATE history SET state=? WHERE id=?", (HISTORY_APPLIED, row["id"])
                )
            return {"ok": True, "message": f"已恢复：{row['title']}", "undo_state": self._undo_state()}

    # --------------------------------------------------------------- recycle
    def get_recycle(self) -> dict:
        with self._lock:
            self._ensure_unlocked()
            pages = self.conn.execute(
                """
                SELECT p.*, (SELECT COUNT(*) FROM records r WHERE r.page_id=p.id AND r.deleted_at IS NULL) rc
                FROM pages p WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC
                """
            ).fetchall()
            page_items = []
            for row in pages:
                page_items.append({
                    "type": "page",
                    "id": row["id"],
                    "name": row["name"],
                    "icon": row["icon"],
                    "description": row["description"] or "",
                    "deleted_at": row["deleted_at"],
                    "record_count": row["rc"],
                })
            rows = self.conn.execute(
                """
                SELECT r.*, p.name page_name, p.deleted_at page_deleted_at
                FROM records r LEFT JOIN pages p ON p.id=r.page_id
                WHERE r.deleted_at IS NOT NULL ORDER BY r.deleted_at DESC LIMIT 300
                """
            ).fetchall()
            record_items = []
            for row in rows:
                cols = self.get_columns(row["page_id"], include_hidden=True)
                data = _loads(row["data"], {})
                preview = []
                for col in cols:
                    if len(preview) >= 3:
                        break
                    if col["masked"]:
                        continue
                    value = self._plain(data.get(col["key"], ""))
                    if value:
                        preview.append({"label": col["label"], "value": value[:60]})
                record_items.append({
                    "type": "record",
                    "id": row["id"],
                    "page_id": row["page_id"],
                    "page_name": row["page_name"] or "已删除页面",
                    "page_deleted": bool(row["page_deleted_at"]),
                    "title": self._record_title(data, cols),
                    "deleted_at": row["deleted_at"],
                    "preview": preview,
                })
            counts = {
                "pages": len(page_items),
                "records": self.conn.execute(
                    "SELECT COUNT(*) c FROM records WHERE deleted_at IS NOT NULL"
                ).fetchone()["c"],
            }
            return {"pages": page_items, "records": record_items, "counts": counts}

    def restore_record(self, record_id: int) -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self.conn.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone()
            if not row or not row["deleted_at"]:
                raise VaultError("记录不在回收站中")
            page = self._page_row(row["page_id"])
            if page["deleted_at"]:
                raise VaultError("所属页面也在回收站中，请先恢复页面")
            before = self._record_snapshot(record_id)
            stamp = now_text()
            with self.conn:
                self.conn.execute(
                    "UPDATE records SET deleted_at=NULL,updated_at=? WHERE id=?",
                    (stamp, record_id),
                )
                after = self._record_snapshot(record_id)
                self._log("restore_record", "record", record_id, row["page_id"],
                          f"恢复记录「{self._record_title(_loads(row['data'], {}), self.get_columns(row['page_id'], True))}」",
                          before, after)
            return {"ok": True}

    def restore_page(self, page_id: int) -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self._page_row(page_id)
            if not row["deleted_at"]:
                raise VaultError("页面不在回收站中")
            before = self._page_snapshot(page_id)
            stamp = now_text()
            with self.conn:
                self.conn.execute(
                    "UPDATE pages SET deleted_at=NULL,updated_at=? WHERE id=?",
                    (stamp, page_id),
                )
                after = self._page_snapshot(page_id)
                self._log("restore_page", "page", page_id, page_id,
                          f"恢复页面「{row['name']}」", before, after)
            return {"ok": True}

    def purge_record(self, record_id: int) -> dict:
        return self.delete_record(record_id, hard=True)

    def purge_page(self, page_id: int) -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self._page_row(page_id)
            if not row["deleted_at"]:
                raise VaultError("只能彻底删除回收站中的页面")
            count = self.conn.execute(
                "SELECT COUNT(*) c FROM records WHERE page_id=?", (page_id,)
            ).fetchone()["c"]
            with self.conn:
                self._hard_delete_page(page_id)
                self._log("purge_page", "page", page_id, page_id,
                          f"彻底删除页面「{row['name']}」及 {count} 条记录",
                          None, None, undoable=0)
            return {"ok": True}

    def empty_recycle(self) -> dict:
        with self._lock:
            self._ensure_unlocked()
            pages = self.conn.execute("SELECT COUNT(*) c FROM pages WHERE deleted_at IS NOT NULL").fetchone()["c"]
            records = self.conn.execute("SELECT COUNT(*) c FROM records WHERE deleted_at IS NOT NULL").fetchone()["c"]
            if not pages and not records:
                raise VaultError("回收站已经是空的")
            with self.conn:
                self.conn.execute("DELETE FROM records WHERE deleted_at IS NOT NULL")
                self.conn.execute("DELETE FROM pages WHERE deleted_at IS NOT NULL")
                self._log("empty_recycle", "vault", None, None,
                          f"清空回收站（{pages} 个页面，{records} 条记录）",
                          None, None, undoable=0)
            return {"ok": True, "pages": pages, "records": records}

    # ------------------------------------------------------------------ misc
    def get_page(self, page_id: int) -> dict:
        with self._lock:
            self._ensure_unlocked()
            row = self._page_row(page_id)
            page = self._page_dict(row)
            page["columns"] = [self._public_column(c) for c in page["columns"]]
            return page

    def stats(self) -> dict:
        with self._lock:
            self._ensure_unlocked()
            return {
                "pages": self.conn.execute(
                    "SELECT COUNT(*) c FROM pages WHERE deleted_at IS NULL"
                ).fetchone()["c"],
                "records": self.conn.execute(
                    "SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL"
                ).fetchone()["c"],
                "secrets": self.conn.execute(
                    "SELECT COUNT(*) c FROM page_columns WHERE type='password'"
                ).fetchone()["c"],
                "history": self.conn.execute("SELECT COUNT(*) c FROM history").fetchone()["c"],
                "recycle_pages": self.conn.execute(
                    "SELECT COUNT(*) c FROM pages WHERE deleted_at IS NOT NULL"
                ).fetchone()["c"],
                "recycle_records": self.conn.execute(
                    "SELECT COUNT(*) c FROM records WHERE deleted_at IS NOT NULL"
                ).fetchone()["c"],
            }

    def copy_record_value(self, record_id: int, key: str) -> str:
        return self.reveal_secret(record_id, key)["value"]

    # ------------------------------------------------------------------ excel
    def preview_excel(self, page_id: int, path: str, password: str = "") -> dict:
        with self._lock:
            self._ensure_unlocked()
            from . import excelio

            cols = self.get_columns(page_id, include_hidden=True)
            result = excelio.preview(path, cols, password=password)
            result["path"] = path
            result["page_id"] = page_id
            return result

    def import_excel(self, page_id: int, path: str, password: str = "") -> dict:
        with self._lock:
            self._ensure_unlocked()
            from . import excelio

            page = self._page_row(page_id)
            if page["deleted_at"]:
                raise VaultError("页面在回收站中，请先恢复")
            cols = self.get_columns(page_id, include_hidden=True)
            rows = excelio.read_rows(path, cols, password=password)
            if not rows:
                raise VaultError("没有读取到可导入的数据")
            stamp = now_text()
            snapshots = []
            with self.conn:
                for values in rows:
                    data = self._pack_values(cols, values)
                    cur = self.conn.execute(
                        "INSERT INTO records(page_id,data,created_at,updated_at) VALUES(?,?,?,?)",
                        (page_id, _json(data), stamp, stamp),
                    )
                    snapshots.append(self._record_snapshot(int(cur.lastrowid)))
                self._log(
                    "import_records", "record", None, page_id,
                    f"从 Excel 导入 {len(rows)} 条记录到「{page['name']}」",
                    None, {"records": snapshots},
                )
            return {"ok": True, "count": len(rows)}

    def export_excel(self, page_id: int, path: str, password: str = "") -> dict:
        with self._lock:
            self._ensure_unlocked()
            from . import excelio

            if password and len(password) < excelio.MIN_WORKBOOK_PASSWORD:
                raise VaultError(f"Excel 密码至少需要 {excelio.MIN_WORKBOOK_PASSWORD} 位")
            page = self._page_row(page_id)
            cols = [c for c in self.get_columns(page_id, include_hidden=True) if c["visible"]]
            rows = self.conn.execute(
                "SELECT * FROM records WHERE page_id=? AND deleted_at IS NULL ORDER BY id",
                (page_id,),
            ).fetchall()
            plain_rows = []
            for row in rows:
                data = _loads(row["data"], {})
                plain_rows.append(self._decrypt_data(data, cols))
            count = excelio.write_export(path, cols, plain_rows, page["name"], password=password)
            return {"ok": True, "count": count, "path": path, "sealed": bool(password)}

    def export_excel_template(self, page_id: int, path: str) -> dict:
        with self._lock:
            self._ensure_unlocked()
            from . import excelio

            cols = [c for c in self.get_columns(page_id, include_hidden=True) if c["visible"]]
            excelio.write_template(path, cols)
            return {"ok": True, "path": path}

    # --------------------------------------------------------------- connect
    def _connection_context(self, record_id: int) -> dict:
        row = self.conn.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone()
        if not row or row["deleted_at"]:
            raise VaultError("记录不存在或在回收站中")
        page = self._page_row(row["page_id"])
        cols = self._cols_for_page(row["page_id"])
        values = self._decrypt_data(_loads(row["data"], {}), cols)
        address = ""
        for key in ("address", "oob", "host", "url"):
            if values.get(key):
                address = values[key].strip()
                break
        if not address:
            for col in cols:
                if col["key"] in ("address", "oob") or "地址" in col["label"]:
                    if values.get(col["key"]):
                        address = values[col["key"]].strip()
                        break
        if not address:
            raise VaultError("该记录没有可用于连接的地址")
        username = values.get("username") or values.get("oob_user") or ""
        password = values.get("password") or ""
        port_text = values.get("port") or ""
        os_text = values.get("os") or ""
        raw = _loads(row["data"], {})
        return {
            "address": address,
            "username": username,
            "password": password,
            "port": port_text,
            "os": os_text,
            "connect_mode": raw.get("connect_mode") or "auto",
            "page_name": page["name"],
            "title": self._record_title(raw, cols),
        }

    @staticmethod
    def _infer_mode(ctx: dict) -> str:
        from . import remote

        # The port may sit in its own column or be written as host:port.
        _host, port = remote.split_host_port(ctx.get("address"), ctx.get("port"), 0)
        if port in (5900, 5901, 5902, 5903):
            return "vnc"
        if port == 3389:
            return "rdp"
        if port == 21:
            return "ftp"
        if port == 23:
            return "telnet"
        if port == 22:
            return "ssh"
        if remote.is_windows_host(ctx.get("os")):
            return "rdp"
        return "ssh"

    def connect_record(self, record_id: int, mode: str | None = None) -> dict:
        with self._lock:
            self._ensure_unlocked()
            ctx = self._connection_context(record_id)
            settings = self.get_settings()
        return self._launch_connection(ctx, settings, mode)

    def _launch_connection(self, ctx: dict, settings: dict, mode: str | None) -> dict:
        from . import remote, sessions

        address = ctx["address"]
        requested = (mode or "").strip().lower()
        if requested not in ("", "auto") and requested not in CONNECT_MODES:
            raise VaultError("不支持的连接方式")

        if remote.is_web_address(address) and requested in ("", "auto"):
            remote.open_web(address)
            return {"ok": True, "mode": "web", "transport": "browser",
                    "target": address, "message": f"已在浏览器中打开 {address}"}

        if requested in ("", "auto"):
            requested = ctx.get("connect_mode") or "auto"
        if requested == "auto":
            requested = self._infer_mode(ctx)
        chosen = requested
        title = f"{ctx['title']} · {chosen.upper()}"

        if chosen == "rdp":
            result = remote.launch_rdp(
                address,
                ctx["username"],
                ctx["port"],
                str(data_dir() / "tmp"),
                settings.get("rdp_fill") or "user",
                ctx["password"],
            )
            return {"ok": True, "mode": "rdp", "transport": "window",
                    "target": result["target"], "pid": result["pid"],
                    "title": title,
                    "message": f"已打开远程桌面：{result['target']}"}

        if chosen == "ssh":
            client = settings.get("ssh_client") or "auto"
            securecrt = remote.find_securecrt(settings.get("securecrt_path") or "")
            if client == "auto":
                client = "securecrt" if securecrt else "builtin"
            if client == "builtin":
                host, port = remote.split_host_port(address, ctx["port"], 22)
                info = sessions.open_ssh(
                    host, port, ctx["username"], ctx["password"], title
                )
                return {"ok": True, "mode": "ssh", "transport": "builtin",
                        "target": f"{host}:{port}", "title": title, **info,
                        "message": f"内置终端已连接：{host}:{port}"}
            exe = securecrt if client == "securecrt" else remote.find_program(
                settings.get(f"{client}_path") or "", client
            )
            if not exe:
                raise VaultError(
                    f"未找到 {self._client_label(client)}，请在设置中指定程序路径"
                )
            target = remote.launch_client(
                client, exe, address, ctx["username"], ctx["password"], ctx["port"]
            )
            return {"ok": True, "mode": "ssh", "transport": "external",
                    "target": target, "title": title,
                    "message": f"已启动 {self._client_label(client)}：{target}"}

        if chosen == "telnet":
            client = settings.get("telnet_client") or "auto"
            if client == "auto":
                if remote.find_securecrt(settings.get("securecrt_path") or ""):
                    client = "securecrt"
                elif remote.find_program(settings.get("putty_path") or "", "putty"):
                    client = "putty"
                else:
                    client = "telnet"
            exe = (remote.find_securecrt(settings.get("securecrt_path") or "")
                   if client == "securecrt"
                   else remote.find_program(
                       settings.get(f"{client}_path") or "", client))
            if not exe:
                raise VaultError(
                    f"未找到 {self._client_label(client)}，请在设置中指定程序路径"
                )
            target = remote.launch_client(
                client, exe, address, ctx["username"], ctx["password"],
                ctx["port"], "telnet",
            )
            return {"ok": True, "mode": "telnet", "transport": "external",
                    "target": target, "title": title,
                    "message": f"已启动 {self._client_label(client)}：{target}"}

        if chosen in ("ftp", "sftp"):
            if settings.get("file_client") == "winscp":
                exe = remote.find_program(settings.get("winscp_path") or "", "winscp")
                if exe:
                    target = remote.launch_winscp(
                        exe, chosen, address, ctx["username"], ctx["password"],
                        ctx["port"],
                    )
                    return {"ok": True, "mode": chosen, "transport": "external",
                            "target": target, "title": title,
                            "message": f"已启动 WinSCP：{target}"}
            host, port = remote.split_host_port(
                address, ctx["port"], 22 if chosen == "sftp" else 21
            )
            info = sessions.open_files(
                chosen, host, port, ctx["username"], ctx["password"], title
            )
            return {"ok": True, "mode": chosen, "transport": "builtin",
                    "target": f"{host}:{port}", "title": title, **info,
                    "message": f"内置{chosen.upper()}已连接：{host}:{port}"}

        if chosen == "vnc":
            if settings.get("vnc_client") == "external":
                exe = remote.find_program(settings.get("vnc_viewer_path") or "", "vncviewer")
                if exe:
                    target = remote.launch_vnc_viewer(exe, address, ctx["port"])
                    return {"ok": True, "mode": "vnc", "transport": "external",
                            "target": target, "title": title,
                            "message": f"已启动 VNC Viewer：{target}"}
            host, port = remote.split_host_port(address, ctx["port"], 5900)
            info = sessions.open_vnc(host, port, title)
            return {"ok": True, "mode": "vnc", "transport": "builtin",
                    "target": f"{host}:{port}", "title": title, **info,
                    "credentials": {"username": ctx["username"],
                                    "password": ctx["password"]},
                    "message": f"内置 VNC 已连接：{host}:{port}"}

        raise VaultError("不支持的连接方式")

    @staticmethod
    def _client_label(client: str) -> str:
        return {
            "securecrt": "SecureCRT",
            "putty": "PuTTY",
            "xshell": "Xshell",
            "openssh": "OpenSSH",
            "telnet": "Telnet",
            "winscp": "WinSCP",
            "vncviewer": "VNC Viewer",
        }.get(client, client)

    # ------------------------------------------------------------ terminals
    def session_list(self) -> list[dict]:
        self._ensure_unlocked()
        from . import sessions

        return sessions.list_info()

    def terminal_read(self, session_id: str, cursor: int = 0) -> dict:
        self._ensure_unlocked()
        from . import sessions

        session = sessions.get(str(session_id))
        if not hasattr(session, "read"):
            raise VaultError("这个会话不是终端")
        return session.read(int(cursor or 0))

    def terminal_write(self, session_id: str, data: str) -> dict:
        self._ensure_unlocked()
        from . import sessions

        session = sessions.get(str(session_id))
        if not hasattr(session, "write"):
            raise VaultError("这个会话不是终端")
        session.write(data or "")
        return {"ok": True}

    def terminal_resize(self, session_id: str, cols: int, rows: int) -> dict:
        self._ensure_unlocked()
        from . import sessions

        session = sessions.get(str(session_id))
        resize = getattr(session, "resize", None)
        if resize:
            resize(int(cols or 80), int(rows or 24))
        return {"ok": True}

    def close_session(self, session_id: str) -> dict:
        from . import sessions

        sessions.close(str(session_id))
        return {"ok": True}

    def files_list(self, session_id: str, path: str = "") -> dict:
        self._ensure_unlocked()
        from . import sessions

        session = sessions.get(str(session_id))
        if not hasattr(session, "list"):
            raise VaultError("这个会话不是文件传输")
        return session.list(path or "")

    def files_mkdir(self, session_id: str, path: str) -> dict:
        self._ensure_unlocked()
        from . import sessions

        sessions.get(str(session_id)).mkdir(path)
        return {"ok": True}

    def files_remove(self, session_id: str, path: str, is_dir: bool = False) -> dict:
        self._ensure_unlocked()
        from . import sessions

        sessions.get(str(session_id)).remove(path, bool(is_dir))
        return {"ok": True}

    def files_rename(self, session_id: str, old: str, new: str) -> dict:
        self._ensure_unlocked()
        from . import sessions

        sessions.get(str(session_id)).rename(old, new)
        return {"ok": True}

    def files_download(self, session_id: str, remote: str, local: str) -> dict:
        self._ensure_unlocked()
        from . import sessions

        return sessions.get(str(session_id)).download(remote, local)

    def files_upload(self, session_id: str, local: str, remote_dir: str) -> dict:
        self._ensure_unlocked()
        from . import sessions

        return sessions.get(str(session_id)).upload(local, remote_dir)

    def local_list(self, path: str = "") -> dict:
        from . import sessions

        return sessions.local_list(path)

    def rdp_focus(self, pid: int) -> dict:
        from . import remote

        return {"focused": remote.focus_window(int(pid))}

    def rdp_close(self, pid: int) -> dict:
        from . import remote

        return {"closed": remote.close_window(int(pid))}

    # ---------------------------------------------------------------- backup
    def build_backup(self) -> dict:
        with self._lock:
            self._ensure_unlocked()
            return self._dump_backup()

    def _dump_backup(self) -> dict:
        """Snapshot the database as-is; every value is already ciphertext.

        It deliberately does not require an unlock: restore uses it to take a
        safety copy while the vault is still locked.
        """
        with self._lock:
            meta = {
                row["k"]: row["v"]
                for row in self.conn.execute("SELECT k,v FROM meta").fetchall()
            }
            pages = [dict(r) for r in self.conn.execute("SELECT * FROM pages ORDER BY id").fetchall()]
            columns = [dict(r) for r in self.conn.execute("SELECT * FROM page_columns ORDER BY page_id,sort_order,id").fetchall()]
            records = [
                {**dict(r), "data": _loads(r["data"], {})}
                for r in self.conn.execute("SELECT * FROM records ORDER BY id").fetchall()
            ]
            history = [
                {**dict(r), "before": _loads(r["before"], None), "after": _loads(r["after"], None)}
                for r in self.conn.execute("SELECT * FROM history ORDER BY id").fetchall()
            ]
            return {
                "format": "MedSafeVault.Backup",
                "version": 2,
                "created_at": now_text(),
                "vault_id": meta.get("vault_id"),
                "app_version": __version__,
                "meta": meta,
                "pages": pages,
                "columns": columns,
                "records": records,
                "history": history,
            }

    def export_backup(self, password: str) -> dict:
        """Build the backup and seal the whole file under a new password."""
        with self._lock:
            payload = self.build_backup()
            if not password:
                raise VaultError("请为备份设置密码")
            return seal_backup(
                password, payload, dek=self.key, created_at=payload.get("created_at") or ""
            )

    def _unwrap_backup(self, payload: dict, password: str | None):
        """Return (payload, dek or None, sealed) for both backup formats."""
        if is_backup_envelope(payload):
            if not password:
                raise VaultError("这是加密备份，请输入导出时设置的备份密码")
            try:
                inner, dek = open_backup(payload, password)
            except CryptoError as exc:
                raise VaultError(str(exc))
            return inner, dek, True
        if not isinstance(payload, dict):
            raise VaultError("备份文件内容无法解析")
        return payload, None, False

    @staticmethod
    def _backup_info(payload: dict, sealed: bool) -> dict:
        if payload.get("format") != "MedSafeVault.Backup":
            raise VaultError("这不是 MedSafeVault 的加密备份文件")
        if int(payload.get("version") or 0) < 1:
            raise VaultError("备份文件版本不受支持")
        meta = payload.get("meta") or {}
        return {
            "created_at": payload.get("created_at"),
            "app_version": payload.get("app_version"),
            "vault_id": payload.get("vault_id"),
            "pages": len(payload.get("pages") or []),
            "records": len(payload.get("records") or []),
            "history": len(payload.get("history") or []),
            "has_recovery": bool(meta.get("wrap_recovery")),
            "sealed": sealed,
        }

    def inspect_backup(self, payload: dict, password: str | None = None) -> dict:
        inner, _dek, sealed = self._unwrap_backup(payload, password)
        return self._backup_info(inner, sealed)

    def restore_backup(self, payload: dict, password: str) -> dict:
        with self._lock:
            payload, dek, sealed = self._unwrap_backup(payload, password)
            info = self._backup_info(payload, sealed)
            meta = payload.get("meta") or {}
            if dek is not None:
                # The envelope carried its own wrap, so the backup password is
                # the only thing the operator has to type.
                if not check_verifier(dek, meta.get("verifier") or ""):
                    raise VaultError("备份内容与该密码不匹配")
            else:
                try:
                    salt = b64d(meta["salt_master"])
                    iterations = int(meta.get("iterations_master") or KDF_ITERATIONS)
                    kek = derive_kek(password, salt, iterations)
                    dek = unwrap_dek(kek, meta.get("wrap_master") or "")
                except (KeyError, ValueError, CryptoError):
                    raise VaultError("备份的打开密码不正确")
                if not check_verifier(dek, meta.get("verifier") or ""):
                    raise VaultError("备份的打开密码不正确")

            auto_backup = None
            try:
                current = self._dump_backup()
                backup_name = f"auto-before-restore-{datetime.now().strftime('%Y%m%d-%H%M%S')}.msvbackup"
                auto_backup = str(data_dir() / backup_name)
                with open(auto_backup, "w", encoding="utf-8") as fh:
                    json.dump(current, fh, ensure_ascii=False, indent=2)
            except Exception as exc:  # pragma: no cover - best effort safety copy
                log.warning("Could not create automatic backup: %s", exc)
                auto_backup = None

            pages = payload.get("pages") or []
            columns = payload.get("columns") or []
            records = payload.get("records") or []
            history = payload.get("history") or []
            try:
                self.conn.execute("BEGIN IMMEDIATE")
                self.conn.execute("DELETE FROM history")
                self.conn.execute("DELETE FROM records")
                self.conn.execute("DELETE FROM page_columns")
                self.conn.execute("DELETE FROM pages")
                self.conn.execute("DELETE FROM meta")
                for k, v in meta.items():
                    self.conn.execute("INSERT INTO meta(k,v) VALUES(?,?)", (k, str(v)))
                for p in pages:
                    self.conn.execute(
                        "INSERT INTO pages(id,name,icon,description,sort_order,created_at,updated_at,deleted_at)"
                        " VALUES(?,?,?,?,?,?,?,?)",
                        (
                            p.get("id"), p.get("name") or "未命名", p.get("icon") or "grid",
                            p.get("description") or "", int(p.get("sort_order") or 0),
                            p.get("created_at") or now_text(), p.get("updated_at") or now_text(),
                            p.get("deleted_at"),
                        ),
                    )
                for c in columns:
                    self.conn.execute(
                        "INSERT INTO page_columns(id,page_id,key,label,type,encrypted,masked,frozen,"
                        "width,visible,required,options,placeholder,sort_order)"
                        " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (
                            c.get("id"), c.get("page_id"), c.get("key"), c.get("label"),
                            c.get("type") or "text", int(c.get("encrypted") or 0),
                            int(c.get("masked") or 0), int(c.get("frozen") or 0),
                            int(c.get("width") or 160),
                            int(c.get("visible", 1)), int(c.get("required") or 0),
                            c.get("options") or "[]", c.get("placeholder") or "",
                            int(c.get("sort_order") or 0),
                        ),
                    )
                for r in records:
                    self.conn.execute(
                        "INSERT INTO records(id,page_id,data,created_at,updated_at,deleted_at)"
                        " VALUES(?,?,?,?,?,?)",
                        (
                            r.get("id"), r.get("page_id"),
                            _json(r.get("data") or {}),
                            r.get("created_at") or now_text(),
                            r.get("updated_at") or now_text(), r.get("deleted_at"),
                        ),
                    )
                for h in history:
                    self.conn.execute(
                        "INSERT INTO history(id,action,entity,entity_id,page_id,title,before,after,"
                        "created_at,state,undoable) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        (
                            h.get("id"), h.get("action"), h.get("entity"), h.get("entity_id"),
                            h.get("page_id"), h.get("title"),
                            _json(h["before"]) if h.get("before") is not None else None,
                            _json(h["after"]) if h.get("after") is not None else None,
                            h.get("created_at") or now_text(), int(h.get("state") or 0),
                            int(h.get("undoable", 1)),
                        ),
                    )
                self.conn.commit()
            except Exception:
                self.conn.rollback()
                raise
            self._set_key(dek)
            self.pending_dek = None
            self.lock_reason = None
            self.last_activity = time.monotonic()
            log.info("Backup restored (%s pages, %s records)", len(pages), len(records))
            return {"state": self.get_state(), "info": info, "auto_backup": auto_backup}

    def close(self) -> None:
        try:
            from . import sessions

            sessions.close_all()
        except Exception:
            pass
        with self._lock:
            try:
                self.conn.close()
            except Exception:
                pass
