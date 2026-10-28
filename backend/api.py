"""Thin, defensive API exposed to the React front-end through pywebview."""
from __future__ import annotations

import json
import logging
import os
import platform
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import webview

from . import __version__
from . import clipboard
from . import paths
from .paths import LocationError, data_dir
from .crypto import is_backup_envelope
from .store import VaultError, VaultLocked, VaultService

log = logging.getLogger(__name__)


class Api:
    def __init__(self, service: VaultService):
        self._service = service
        self._window: webview.Window | None = None
        self._pending_backup: dict | None = None
        self._pending_backup_path: str | None = None

    def _attach(self, window: webview.Window) -> None:
        self._window = window

    # --------------------------------------------------------------- helpers
    def _guard(self, fn, *args, **kwargs) -> dict:
        try:
            result = fn(*args, **kwargs)
            if isinstance(result, dict):
                return {"ok": True, **result}
            return {"ok": True, "data": result}
        except VaultLocked as exc:
            return {"ok": False, "locked": True, "error": str(exc)}
        except VaultError as exc:
            return {"ok": False, "error": str(exc)}
        except Exception as exc:  # pragma: no cover - defensive
            log.exception("API error in %s", getattr(fn, "__name__", fn))
            return {"ok": False, "error": f"操作失败：{exc}"}

    @staticmethod
    def _first_path(result) -> str | None:
        if not result:
            return None
        if isinstance(result, (list, tuple)):
            return str(result[0]) if result else None
        return str(result)

    def _save_dialog(self, filename: str, file_types: tuple[str, ...]) -> str | None:
        if not self._window:
            raise VaultError("窗口尚未就绪")
        result = self._window.create_file_dialog(
            webview.FileDialog.SAVE, save_filename=filename, file_types=file_types
        )
        return self._first_path(result)

    def _open_dialog(self, file_types: tuple[str, ...]) -> str | None:
        if not self._window:
            raise VaultError("窗口尚未就绪")
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False, file_types=file_types
        )
        return self._first_path(result)

    @staticmethod
    def _ensure_ext(path: str, ext: str) -> str:
        if path and not os.path.splitext(path)[1]:
            return path + ext
        return path

    # ---------------------------------------------------------------- session
    def get_state(self) -> dict:
        return self._guard(lambda: {"state": self._service.get_state()})

    def get_bootstrap(self) -> dict:
        return self._guard(lambda: {
            "state": self._service.get_state(),
            "templates": self._service.get_page_templates(),
            "version": __version__,
        })

    def initialize(self, password: str) -> dict:
        def action():
            result = self._service.initialize(password)
            recovery = result.get("recovery") or {}
            recovery.pop("payload", None)
            return {"state": result.get("state"), "recovery": recovery}
        return self._guard(action)

    def unlock(self, password: str) -> dict:
        return self._guard(lambda: self._service.unlock(password))

    def lock(self) -> dict:
        def action():
            self._service.lock("manual")
            return {"state": self._service.get_state()}
        return self._guard(action)

    def heartbeat(self) -> dict:
        return self._guard(lambda: self._service.heartbeat())

    def activity(self) -> dict:
        return self._guard(lambda: self._service.touch())

    def change_master_password(self, old_password: str, new_password: str) -> dict:
        return self._guard(
            lambda: self._service.change_master_password(old_password, new_password)
        )

    # --------------------------------------------------------------- recovery
    def get_recovery_status(self) -> dict:
        return self._guard(lambda: {"recovery": self._service.recovery_status()})

    def rotate_recovery(self) -> dict:
        def action():
            data = self._service.rotate_recovery()
            data.pop("payload", None)
            return {"recovery": data, "status": self._service.recovery_status()}
        return self._guard(action)

    def save_recovery_file(self) -> dict:
        def action():
            filename = f"MedSafeVault-恢复密钥-{datetime.now().strftime('%Y%m%d')}.msvkey"
            path = self._save_dialog(filename, ("恢复密钥文件 (*.msvkey)",))
            if not path:
                return {"cancelled": True}
            path = self._ensure_ext(path, ".msvkey")
            content = self._service.recovery_file_content()
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(content)
            self._show_message("恢复密钥已保存", f"请离线妥善保管：\n{path}")
            return {"path": path}
        return self._guard(action)

    def pick_recovery_file(self) -> dict:
        def action():
            path = self._open_dialog(("恢复密钥文件 (*.msvkey;*.json)", "所有文件 (*.*)"))
            if not path:
                return {"cancelled": True}
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    payload = json.load(handle)
            except Exception:
                raise VaultError("无法读取恢复密钥文件")
            result = self._service.start_recovery_with_json(payload)
            return {"path": path, **result}
        return self._guard(action)

    def start_recovery_with_code(self, code: str) -> dict:
        return self._guard(lambda: self._service.start_recovery_with_code(code))

    def finish_recovery(self, new_password: str) -> dict:
        return self._guard(lambda: self._service.finish_recovery(new_password))

    def cancel_recovery(self) -> dict:
        self._service.cancel_recovery()
        return {"ok": True}

    # ------------------------------------------------------------------ pages
    def get_templates(self) -> dict:
        return self._guard(lambda: {"templates": self._service.get_page_templates()})

    def get_pages(self) -> dict:
        return self._guard(lambda: {"pages": self._service.get_pages()})

    def create_page(self, payload: dict) -> dict:
        return self._guard(lambda: {"page": self._service.create_page(payload or {})})

    def update_page(self, page_id: int, payload: dict) -> dict:
        return self._guard(
            lambda: {"page": self._service.update_page(int(page_id), payload or {})}
        )

    def delete_page(self, page_id: int) -> dict:
        return self._guard(lambda: self._service.delete_page(int(page_id)))

    def get_page(self, page_id: int) -> dict:
        return self._guard(lambda: {"page": self._service.get_page(int(page_id))})

    # ---------------------------------------------------------------- records
    def list_records(self, page_id: int, query: str = "", offset: int = 0,
                     limit: int = 50, sort_key: str | None = None,
                     sort_dir: str = "asc") -> dict:
        return self._guard(lambda: self._service.list_records(
            int(page_id), query or "", int(offset), int(limit), sort_key, sort_dir
        ))

    def get_record(self, record_id: int) -> dict:
        return self._guard(lambda: {"record": self._service.get_record(int(record_id))})

    def save_record(self, page_id: int, values: dict, record_id: int | None = None) -> dict:
        rid = int(record_id) if record_id else None
        return self._guard(
            lambda: self._service.save_record(int(page_id), values or {}, rid)
        )

    def delete_record(self, record_id: int) -> dict:
        return self._guard(lambda: self._service.delete_record(int(record_id)))

    def delete_records(self, record_ids: list) -> dict:
        return self._guard(lambda: self._service.delete_records(list(record_ids or [])))

    def suggest_values(self, page_id: int, key: str, query: str = "",
                       limit: int = 10) -> dict:
        return self._guard(lambda: self._service.suggest_values(
            int(page_id), str(key), query or "", int(limit)
        ))

    def reveal_secret(self, record_id: int, key: str) -> dict:
        return self._guard(lambda: self._service.reveal_secret(int(record_id), key))

    def generate_password(self, length: int = 18, symbols: bool = True) -> dict:
        return self._guard(lambda: self._service.generate_password(int(length), bool(symbols)))

    # ---------------------------------------------------------------- history
    def get_history(self, offset: int = 0, limit: int = 40, kind: str = "all",
                    query: str = "") -> dict:
        return self._guard(lambda: self._service.get_history(
            int(offset), int(limit), kind or "all", query or ""
        ))

    def reveal_history(self, history_id: int, side: str, key: str) -> dict:
        return self._guard(lambda: self._service.reveal_history(int(history_id), side, key))

    def undo(self) -> dict:
        return self._guard(self._service.undo)

    def redo(self) -> dict:
        return self._guard(self._service.redo)

    # ---------------------------------------------------------------- recycle
    def get_recycle(self) -> dict:
        return self._guard(self._service.get_recycle)

    def restore_record(self, record_id: int) -> dict:
        return self._guard(lambda: self._service.restore_record(int(record_id)))

    def restore_page(self, page_id: int) -> dict:
        return self._guard(lambda: self._service.restore_page(int(page_id)))

    def purge_record(self, record_id: int) -> dict:
        return self._guard(lambda: self._service.purge_record(int(record_id)))

    def purge_page(self, page_id: int) -> dict:
        return self._guard(lambda: self._service.purge_page(int(page_id)))

    def empty_recycle(self) -> dict:
        return self._guard(self._service.empty_recycle)

    # -------------------------------------------------------------- clipboard
    def copy_text(self, text: str) -> dict:
        def action():
            clipboard.copy_with_autoclear(text or "", 0)
            return {"ok": True}
        return self._guard(action)

    def copy_secret(self, record_id: int, key: str) -> dict:
        def action():
            value = self._service.reveal_secret(int(record_id), key)["value"]
            clipboard.copy_with_autoclear(value, 30)
            return {"seconds": 30}
        return self._guard(action)

    # ---------------------------------------------------------------- connect
    def connect(self, record_id: int, mode: str | None = None) -> dict:
        return self._guard(lambda: self._service.connect_record(int(record_id), mode))

    # ------------------------------------------------------------------ excel
    def preview_excel(self, page_id: int) -> dict:
        def action():
            path = self._open_dialog((
                "Excel / CSV (*.xlsx;*.xls;*.csv)", "所有文件 (*.*)"
            ))
            if not path:
                return {"cancelled": True}
            data = self._service.preview_excel(int(page_id), path)
            return {"preview": data}
        return self._guard(action)

    def import_excel(self, page_id: int, path: str) -> dict:
        return self._guard(lambda: self._service.import_excel(int(page_id), path))

    def export_excel(self, page_id: int) -> dict:
        def action():
            page = self._service.get_page(int(page_id))
            filename = f"{page['name']}-{datetime.now().strftime('%Y%m%d')}.xlsx"
            path = self._save_dialog(filename, ("Excel 文件 (*.xlsx)",))
            if not path:
                return {"cancelled": True}
            path = self._ensure_ext(path, ".xlsx")
            return self._service.export_excel(int(page_id), path)
        return self._guard(action)

    def export_template(self, page_id: int) -> dict:
        def action():
            page = self._service.get_page(int(page_id))
            filename = f"{page['name']}-导入模板.xlsx"
            path = self._save_dialog(filename, ("Excel 文件 (*.xlsx)",))
            if not path:
                return {"cancelled": True}
            path = self._ensure_ext(path, ".xlsx")
            return self._service.export_excel_template(int(page_id), path)
        return self._guard(action)

    # ----------------------------------------------------------------- backup
    def export_backup(self, password: str = "") -> dict:
        def action():
            # The whole file is sealed under this password, so the export is
            # useless to anyone who does not know it - including the structure.
            payload = self._service.export_backup(password or "")
            filename = f"MedSafeVault-备份-{datetime.now().strftime('%Y%m%d-%H%M')}.msvbackup"
            path = self._save_dialog(filename, ("加密备份 (*.msvbackup)",))
            if not path:
                return {"cancelled": True}
            path = self._ensure_ext(path, ".msvbackup")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
            return {"path": path, "sealed": True}
        return self._guard(action)

    def pick_backup(self) -> dict:
        def action():
            path = self._open_dialog(("加密备份 (*.msvbackup;*.json)", "所有文件 (*.*)"))
            if not path:
                return {"cancelled": True}
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    payload = json.load(handle)
                if is_backup_envelope(payload):
                    # Nothing can be read out of a sealed file before the
                    # password arrives: report the shape, not the contents.
                    info = None
                else:
                    info = self._service.inspect_backup(payload)
            except VaultError:
                raise
            except Exception:
                raise VaultError("无法读取备份文件，文件可能已损坏")
            self._pending_backup = payload
            self._pending_backup_path = path
            return {"path": path, "info": info, "sealed": info is None}
        return self._guard(action)

    def preview_backup(self, password: str) -> dict:
        def action():
            if not self._pending_backup:
                raise VaultError("请先选择备份文件")
            return {"info": self._service.inspect_backup(self._pending_backup, password or "")}
        return self._guard(action)

    def restore_backup(self, password: str) -> dict:
        def action():
            if not self._pending_backup:
                raise VaultError("请先选择备份文件")
            result = self._service.restore_backup(self._pending_backup, password or "")
            self._pending_backup = None
            self._pending_backup_path = None
            return result
        return self._guard(action)

    def cancel_backup(self) -> dict:
        self._pending_backup = None
        self._pending_backup_path = None
        return {"ok": True}

    # --------------------------------------------------------------- settings
    def set_settings(self, patch: dict) -> dict:
        return self._guard(lambda: {"settings": self._service.set_settings(patch or {})})

    def choose_securecrt(self) -> dict:
        def action():
            path = self._open_dialog(("SecureCRT (SecureCRT.exe)", "可执行文件 (*.exe)"))
            if not path:
                return {"cancelled": True}
            settings = self._service.set_settings({"securecrt_path": path})
            return {"settings": settings}
        return self._guard(action)

    def get_about(self) -> dict:
        def action():
            info = {
                "version": __version__,
                "data_dir": str(data_dir()),
                "db_file": self._service.db_file,
                "db_size": os.path.getsize(self._service.db_file) if os.path.exists(self._service.db_file) else 0,
                "python": platform.python_version(),
                "platform": platform.platform(),
                "crypto": "AES-256-GCM / PBKDF2-SHA256 (600,000)",
            }
            try:
                info["stats"] = self._service.stats()
            except VaultLocked:
                info["stats"] = None
            return {"about": info}
        return self._guard(action)

    def open_data_dir(self) -> dict:
        def action():
            os.startfile(str(data_dir()))  # type: ignore[attr-defined]
            return {"ok": True}
        return self._guard(action)

    def open_path(self, path: str) -> dict:
        def action():
            folder = os.path.dirname(path) if os.path.isfile(path) else path
            os.startfile(folder)  # type: ignore[attr-defined]
            return {"ok": True}
        return self._guard(action)

    # ------------------------------------------------------ data location
    def _location_guard(self, fn):
        """LocationError is user-facing prose, so turn it into a VaultError."""
        try:
            return fn()
        except LocationError as exc:
            raise VaultError(str(exc)) from exc

    def get_data_location(self) -> dict:
        return self._guard(lambda: {"location": self._location_guard(paths.location_summary)})

    def set_data_location(self, mode: str, path: str | None = None) -> dict:
        def action():
            result = self._location_guard(lambda: paths.request_location(mode, path))
            log.info("Data directory change requested: %s", result.get("pending"))
            return result
        return self._guard(action)

    def cancel_data_location(self) -> dict:
        return self._guard(lambda: self._location_guard(paths.cancel_location_request))

    def choose_data_dir(self) -> dict:
        def action():
            if not self._window:
                raise VaultError("窗口尚未就绪")
            result = self._window.create_file_dialog(webview.FileDialog.FOLDER)
            path = self._first_path(result)
            if not path:
                return {"cancelled": True}
            return {"path": path, "pending": self._location_guard(lambda: paths.pending_location())}
        return self._guard(action)

    def get_environment(self) -> dict:
        """Raw environment values, shown next to their explanation."""
        def action():
            return {
                "environment": {
                    "MEDSAFE_DATA_DIR": paths.env_override() or None,
                    "MSV_DEV_URL": os.environ.get("MSV_DEV_URL", "").strip() or None,
                    "MSV_DEBUG": os.environ.get("MSV_DEBUG", "").strip() or None,
                }
            }
        return self._guard(action)

    # ---------------------------------------------------------------- native
    def _show_message(self, title: str, message: str) -> None:
        """Small helper that avoids blocking API threads when possible."""
        if not self._window:
            return
        try:
            self._window.evaluate_js(
                "window.__msvNativeMessage && window.__msvNativeMessage("
                + json.dumps(title, ensure_ascii=False) + ","
                + json.dumps(message, ensure_ascii=False) + ")"
            )
        except Exception:
            log.debug("Could not show in-app message", exc_info=True)

    def quit(self) -> None:
        if self._window:
            try:
                self._window.destroy()
            except Exception:
                pass
