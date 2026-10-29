"""Developer self-test for the vault service (no GUI)."""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.store import VaultError, VaultLocked, VaultService  # noqa: E402


def check(condition, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"  ok  {message}")


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="msv-test-"))
    db = tmp / "vault.db"
    svc = VaultService(str(db))
    print("[1] initialize / pages")
    result = svc.initialize("CorrectHorse2026!")
    check(svc.has_master(), "master initialized")
    check(svc.key is not None, "unlocked after initialize")
    pages = svc.get_pages()
    check(len(pages) == 4, f"4 default pages (got {len(pages)})")
    server = next(p for p in pages if p["name"] == "服务器")
    check(any(c["key"] == "password" and c["masked"] for c in server["columns"]), "password column masked")

    print("[2] records + encryption at rest")
    values = {
        "type": "物理机", "address": "192.168.0.10", "app": "HIS 数据库",
        "os": "CentOS 7", "username": "dba_user", "password": "S3cret!Pass",
        "port": "22", "oob": "192.168.1.10", "oob_user": "oobadmin",
        "oob_pass": "OobPass!", "note": "核心库",
    }
    created = svc.save_record(server["id"], values)
    rid = created["record"]["id"]
    raw = svc.conn.execute("SELECT data FROM records WHERE id=?", (rid,)).fetchone()["data"]
    check("S3cret!Pass" not in raw, "password not stored in plaintext")
    check("dba_user" not in raw, "username not stored in plaintext")
    listing = svc.list_records(server["id"])
    row = listing["rows"][0]
    check(row["cells"]["password"]["masked"], "password masked in list")
    check(row["cells"]["password"]["value"] != "S3cret!Pass", "password value hidden")
    check(row["cells"]["username"]["value"] == "dba_user", "username visible but encrypted")
    check(svc.reveal_secret(rid, "password")["value"] == "S3cret!Pass", "reveal returns plaintext")

    print("[3] history / undo / redo")
    svc.save_record(server["id"], {**values, "password": "NewPass#2026"}, rid)
    hist = svc.get_history()
    check(hist["items"][0]["action"] == "update_record", "update logged")
    check(any(c["key"] == "password" and c["masked"] for c in hist["items"][0]["changes"]), "password masked in history")
    check(svc.reveal_history(hist["items"][0]["id"], "before", "password")["value"] == "S3cret!Pass", "history reveal works")
    svc.undo()
    check(svc.reveal_secret(rid, "password")["value"] == "S3cret!Pass", "undo restored old password")
    svc.redo()
    check(svc.reveal_secret(rid, "password")["value"] == "NewPass#2026", "redo re-applied password")
    svc.undo()

    print("[4] delete / recycle / restore")
    svc.delete_record(rid)
    check(svc.list_records(server["id"])["total"] == 0, "deleted record hidden")
    recycle = svc.get_recycle()
    check(recycle["counts"]["records"] == 1, "record in recycle bin")
    svc.restore_record(rid)
    check(svc.list_records(server["id"])["total"] == 1, "record restored")
    # undo the restore -> deleted again, then undo that delete -> restored
    svc.undo()
    check(svc.list_records(server["id"])["total"] == 0, "undo restore moves record back to recycle")
    svc.undo()
    check(svc.list_records(server["id"])["total"] == 1, "undo delete restores record")

    print("[4b] manual row order (drag handle / up-down)")
    ids = [rid]
    for name in ("排序A", "排序B", "排序C"):
        created = svc.save_record(server["id"], {**values, "app": name})
        ids.append(created["record"]["id"])

    def order(page_id=server["id"], query=""):
        return [row["id"] for row in svc.list_records(page_id, query=query)["rows"]]

    base = order()
    check(base == ids, f"new records append in creation order ({base})")
    check(all(row["sort_order"] > 0 for row in svc.list_records(server["id"])["rows"]),
          "list exposes sort_order")

    moved = [base[-1]] + base[:-1]
    result = svc.reorder_records(server["id"], moved)
    check(result["moved"] == len(base), f"reorder reports {result['moved']} moved rows")
    check(order() == moved, f"reorder applied ({order()})")
    check(svc.get_history()["items"][0]["action"] == "move_record", "move written to history")
    svc.undo()
    check(order() == base, f"undo restores the previous order ({order()})")
    svc.redo()
    check(order() == moved, "redo re-applies the order")

    # A search filter only reorders the visible rows; hidden rows keep their slot.
    visible = [i for i in order() if i != rid]
    slots_before = {
        row["id"]: row["sort_order"] for row in svc.list_records(server["id"])["rows"]
    }
    svc.reorder_records(server["id"], list(reversed(visible)))
    filtered = order(query="排序")
    check(filtered == list(reversed(visible)), f"subset reorder ({filtered})")
    slots_after = {
        row["id"]: row["sort_order"] for row in svc.list_records(server["id"])["rows"]
    }
    check(slots_after[rid] == slots_before[rid],
          f"unlisted row keeps its slot ({slots_before[rid]} -> {slots_after[rid]})")
    check([i for i in order() if i != rid] == list(reversed(visible)),
          "listed rows follow the new order around the untouched row")
    svc.undo()
    check(order() == moved, "undo puts the whole page back")

    # A single row (or an empty list) is a no-op and must not pollute history.
    before_count = svc.get_history()["total"]
    check(svc.reorder_records(server["id"], [rid])["moved"] == 0, "one row reorder is a no-op")
    check(svc.reorder_records(server["id"], [rid, 999999])["moved"] == 0, "unknown ids are skipped")
    check(svc.get_history()["total"] == before_count, "no-op moves are not logged")

    # Leave the page with exactly the one record later sections assume.
    for extra in ids[1:]:
        svc.delete_record(extra, hard=True)
    check(svc.list_records(server["id"])["total"] == 1, "order test cleaned up")

    print("[5] pages CRUD + column config")
    tpl = next(t for t in svc.get_page_templates() if t["id"] == "blank")
    page = svc.create_page({
        "name": "测试页面", "icon": "shield", "description": "测试",
        "columns": tpl["columns"] + [{
            "label": "环境", "type": "select", "options": ["生产", "测试"],
            "width": 100, "encrypted": False, "masked": False,
        }],
    })
    pid = page["id"]
    check(len(page["columns"]) == 5, "custom column added")
    page_payload = {
        "name": "测试页面2", "icon": "shield", "description": "改名",
        "columns": page["columns"],
    }
    page_payload["columns"][0]["label"] = "系统名称"
    page_payload["columns"] = [c for c in page_payload["columns"] if c["label"] != "备注"]
    updated = svc.update_page(pid, page_payload)
    check(updated["name"] == "测试页面2", "page renamed")
    check(len(updated["columns"]) == 4, "column deleted")
    svc.delete_page(pid)
    check(all(p["id"] != pid for p in svc.get_pages()), "page hidden after delete")
    check(any(p["id"] == pid for p in svc.get_recycle()["pages"]), "page in recycle")
    svc.restore_page(pid)
    check(any(p["id"] == pid for p in svc.get_pages()), "page restored")
    svc.undo()
    check(all(p["id"] != pid for p in svc.get_pages()), "undo page restore")
    svc.undo()
    check(any(p["id"] == pid for p in svc.get_pages()), "undo page delete")

    print("[6] master password change")
    current_password = svc.reveal_secret(rid, "password")["value"]
    svc.change_master_password("CorrectHorse2026!", "EvenBetterPass2026!")
    svc.lock("manual")
    try:
        svc.unlock("CorrectHorse2026!")
        raise AssertionError("old password should fail")
    except VaultError:
        print("  ok  old password rejected")
    svc.unlock("EvenBetterPass2026!")
    check(svc.key is not None, "new password unlocks")
    check(svc.reveal_secret(rid, "password")["value"] == current_password, "data intact after rewrap")

    print("[7] recovery code resets password")
    recovery = svc.rotate_recovery()
    code = recovery["code"]
    payload = svc._pending_recovery
    svc.lock("manual")
    svc.start_recovery_with_code(code)
    svc.finish_recovery("RecoveredPass#2026")
    check(svc.key is not None, "unlocked after recovery")
    check(svc.reveal_secret(rid, "password")["value"] == current_password, "data intact after recovery")

    print("[8] recovery file payload")
    check(payload is not None, "recovery payload available for download")
    svc.lock("manual")
    svc.start_recovery_with_json(payload)
    svc.finish_recovery("FileRecovered2026!")
    check(svc.key is not None, "recovery file accepted")

    print("[9] backup / restore")
    backup = svc.build_backup()
    info = svc.inspect_backup(backup)
    check(info["records"] >= 1, "backup contains records")
    check(current_password not in json.dumps(backup), "backup does not leak plaintext")
    password = "FileRecovered2026!"
    svc.delete_record(rid)
    restored = svc.restore_backup(backup, password)
    check(restored["state"]["locked"] is False, "unlocked after restore")
    check(svc.list_records(server["id"])["total"] == 1, "record restored from backup")
    check(Path(restored["auto_backup"]).exists(), "automatic safety backup created")

    print("[10] excel export / import")
    xlsx = tmp / "export.xlsx"
    svc.export_excel(server["id"], str(xlsx))
    check(xlsx.exists(), "excel export written")
    preview = svc.preview_excel(server["id"], str(xlsx))
    check(preview["rows"] >= 1, "excel preview reads rows")
    imported = svc.import_excel(server["id"], str(xlsx))
    check(imported["count"] >= 1, "excel import works")
    hist = svc.get_history(limit=5)
    check(any(i["action"] == "import_records" for i in hist["items"]), "batch import logged")
    svc.undo()
    print("  ok  batch import undone")

    print("[11] auto lock")
    svc.set_settings({"auto_lock_minutes": 1})
    svc.last_activity -= 61
    state = svc.get_state()
    check(state["locked"], "auto lock engages")
    svc.lock("manual")

    svc.close()
    shutil.rmtree(tmp, ignore_errors=True)
    print("\nAll backend self-tests passed.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        raise
