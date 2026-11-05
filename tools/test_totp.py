"""Two-factor (RFC 6238 TOTP) checks: algorithm, enrolment, unlock gating.

Run:  .venv\\Scripts\\python.exe tools\\test_totp.py
"""
from __future__ import annotations

import base64
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import totp  # noqa: E402
from backend.store import VaultError, VaultService  # noqa: E402

PASSWORD = "CorrectHorse2026!"
OTHER = "EvenBetterPass2026!"

# RFC 4226 Appendix D key, the same one RFC 6238 lists vectors for.
VECTOR_SECRET = base64.b32encode(b"12345678901234567890").decode("ascii")

FIXED_STEP = int(time.time() // totp.PERIOD)


def check(condition, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"  ok  {message}")


def expect_error(fn, needle: str, message: str) -> None:
    try:
        fn()
    except VaultError as exc:
        assert needle in str(exc), f"{message}: expected {needle!r}, got {exc}"
        print(f"  ok  {message} ({exc})")
        return
    raise AssertionError(f"{message}: no error raised")


def live_code(secret: str, step: int | None = None) -> str:
    return totp.code_at(secret, step if step is not None else totp.current_step())


def test_algorithm() -> None:
    print("[1] RFC 6238 vectors and window")
    vectors = {
        59: "94287082",
        1111111109: "07081804",
        1111111111: "14050471",
        1234567890: "89005924",
        2000000000: "69279037",
        20000000000: "65353130",
    }
    for at, want in vectors.items():
        got = totp.code_at(VECTOR_SECRET, at // totp.PERIOD, digits=8)
        check(got == want, f"T={at} gives {want}")
    check(totp.code_at(VECTOR_SECRET, 1) == "287082", "6-digit code is the low 6 digits")

    ok, step = totp.verify(VECTOR_SECRET, "287082", at=59.0)
    check(ok and step == 1, "exact step accepted")
    ok, _ = totp.verify(VECTOR_SECRET, totp.code_at(VECTOR_SECRET, 0), at=30.0)
    check(ok, "one step back accepted (drift)")
    ok, _ = totp.verify(VECTOR_SECRET, totp.code_at(VECTOR_SECRET, 2), at=30.0)
    check(ok, "one step forward accepted (drift)")
    ok, _ = totp.verify(VECTOR_SECRET, totp.code_at(VECTOR_SECRET, 4), at=30.0)
    check(not ok, "two steps ahead rejected")
    ok, _ = totp.verify(VECTOR_SECRET, "000000", at=59.0)
    check(not ok, "wrong code rejected")
    ok, _ = totp.verify(VECTOR_SECRET, "12345", at=59.0)
    check(not ok, "short code rejected")
    ok, _ = totp.verify(VECTOR_SECRET, "abc123", at=59.0)
    check(not ok, "non digits rejected")
    check(totp.verify(VECTOR_SECRET, f" {totp.code_at(VECTOR_SECRET, 1)} ", at=59.0)[0],
          "spaces around the code are tolerated")
    check(totp.decode_secret(totp.new_secret()) and True, "generated secret decodes")
    uri = totp.provisioning_uri(VECTOR_SECRET, "vault-abcd1234")
    check(uri.startswith("otpauth://totp/MedSafeVault%3Avault-abcd1234?"), f"uri label: {uri[:40]}")
    for part in ("secret=" + VECTOR_SECRET, "issuer=MedSafeVault", "algorithm=SHA1",
                 "digits=6", "period=30"):
        check(part in uri, f"uri carries {part.split('=')[0]}")
    check(totp.seconds_left(at=59.0) == 1, "seconds_left counts down inside the step")


def service_in(tmp: Path) -> VaultService:
    return VaultService(str(tmp / "vault.db"))


def bind(service: VaultService) -> str:
    """Enrol and confirm, returning the secret that ended up bound."""
    info = service.totp_begin()
    secret = info["secret"]
    check(info["status"]["enabled"] is False, "begin leaves the vault unlocked but unarmed")
    check(info["status"]["pending"] is True, "begin marks a pending enrolment")
    check("secret=" in info["uri"], "begin returns a provisioning URI")
    expect_error(lambda: service.totp_verify("000000"), "动态验证码不正确", "wrong code keeps it off")
    check(service.totp_status()["enabled"] is False, "failed verify does not enable")
    result = service.totp_verify(live_code(secret))
    check(result["status"]["enabled"] is True, "correct code enables the binding")
    check(service.get_state()["totp_required"] is True, "state advertises the requirement")
    return secret


def test_binding(tmp: Path) -> None:
    print("[2] enrolment through the service")
    service = service_in(tmp)
    service.initialize(PASSWORD)
    secret = bind(service)
    raw = b"".join(p.read_bytes() for p in tmp.iterdir() if p.is_file())
    check(secret.encode() not in raw, "secret is not stored in plaintext")
    check(b"otpauth" not in raw, "provisioning URI is not stored in plaintext")
    check(base64.b32decode(secret) not in raw, "raw secret bytes are not in the database")
    check(service.totp_status()["enabled_at"], "binding records when it happened")

    # re-binding replaces the old secret
    second = service.totp_begin()["secret"]
    check(second != secret, "begin generates a fresh secret")
    check(service.totp_verify(live_code(second))["status"]["enabled"] is True,
          "re-binding confirms the new secret")
    expect_error(lambda: service.totp_verify(live_code(secret)), "请先生成二维码",
                 "the abandoned enrolment is gone")
    service.close()


def test_unlock(tmp: Path) -> None:
    print("[3] unlock requires password and code")
    service = service_in(tmp)
    service.initialize(PASSWORD)
    secret = bind(service)
    real_step = totp.current_step
    totp.current_step = lambda *a, **k: FIXED_STEP
    try:
        code = totp.code_at(secret, FIXED_STEP)
        service.lock("manual")
        expect_error(lambda: service.unlock(PASSWORD), "请输入验证器里的 6 位动态验证码",
                     "missing code is refused")
        check(service.key is None, "vault stays locked without the code")
        expect_error(lambda: service.unlock(PASSWORD, "000000"), "打开密码或动态验证码不正确",
                     "wrong code is refused")
        expect_error(lambda: service.unlock(OTHER, code), "打开密码不正确",
                     "wrong password does not leak that the code was right")
        state = service.unlock(PASSWORD, code)["state"]
        check(state["locked"] is False, "password plus code unlocks")
        service.lock("manual")
        expect_error(lambda: service.unlock(PASSWORD, code), "已经使用过",
                     "the same code cannot be replayed in its own step")
        check(service.key is None, "a replay leaves the vault locked")
        # next step works again
        totp.current_step = lambda *a, **k: FIXED_STEP + 1
        check(service.unlock(PASSWORD, totp.code_at(secret, FIXED_STEP + 1))["state"]["locked"]
              is False, "the next code unlocks again")
        # and the binding survives a password change, because only the wrap moves
        service.change_master_password(PASSWORD, OTHER)
        totp.current_step = lambda *a, **k: FIXED_STEP + 2
        check(service.unlock(OTHER, totp.code_at(secret, FIXED_STEP + 2))["state"]["locked"]
              is False, "changing the password keeps the binding")
    finally:
        totp.current_step = real_step
    service.close()


def test_pending_expiry(tmp: Path) -> None:
    print("[4] enrolment times out")
    service = service_in(tmp)
    service.initialize(PASSWORD)
    info = service.totp_begin()
    service._meta_set("totp_pending_epoch", str(time.time() - (totp.PENDING_MINUTES * 60 + 5)))
    expect_error(lambda: service.totp_verify(live_code(info["secret"])), "绑定已超时",
                 "a stale enrolment must be regenerated")
    check(service.totp_status()["pending"] is False, "stale enrolment is cleared")
    service.close()


def test_disable(tmp: Path) -> None:
    print("[5] turning it off costs password and code")
    service = service_in(tmp)
    service.initialize(PASSWORD)
    secret = bind(service)
    code = live_code(secret)
    expect_error(lambda: service.totp_disable(OTHER, code), "打开密码不正确",
                 "wrong password cannot drop the factor")
    expect_error(lambda: service.totp_disable(PASSWORD, "111111"), "打开密码或动态验证码不正确",
                 "wrong code cannot drop the factor")
    result = service.totp_disable(PASSWORD, code)
    check(result["status"]["enabled"] is False, "password plus code disables")
    check(service.get_state()["totp_required"] is False, "state stops asking for it")
    service.lock("manual")
    check(service.unlock(PASSWORD)["state"]["locked"] is False, "unlock works without a code")
    expect_error(lambda: service.totp_disable(PASSWORD, code), "当前未开启动态验证码",
                 "disabling twice is refused")
    service.close()


def test_recovery_and_backup(tmp: Path) -> None:
    print("[6] recovery key and restored backups clear the factor")
    service = service_in(tmp)
    service.initialize(PASSWORD)
    secret = bind(service)
    recovery = service._create_recovery(rotate=True)
    code = recovery["code"]
    service.lock("manual")
    service.start_recovery_with_code(code)
    result = service.finish_recovery(OTHER)
    check(result["totp_reset"] is True, "recovery reports it cleared the binding")
    check(service.totp_status()["enabled"] is False, "recovery removes the factor")
    check(service.unlock(OTHER)["state"]["locked"] is False, "new password unlocks alone")

    bind(service)
    backup = service.export_backup(PASSWORD)
    service.lock("manual")
    restored = service.restore_backup(backup, PASSWORD)
    check(restored["totp_reset"] is True, "restoring a backup reports the reset")
    check(service.totp_status()["enabled"] is False, "restored vault does not demand a code")
    service.close()


def test_cancel_and_locked_guard(tmp: Path) -> None:
    print("[7] cancel and locked vault")
    service = service_in(tmp)
    service.initialize(PASSWORD)
    service.totp_begin()
    check(service.totp_cancel()["status"]["pending"] is False, "cancel drops the enrolment")
    bind(service)
    service.lock("manual")
    for name, call in (
        ("totp_begin", lambda: service.totp_begin()),
        ("totp_verify", lambda: service.totp_verify("123456")),
        ("totp_disable", lambda: service.totp_disable(PASSWORD, "123456")),
    ):
        try:
            call()
            raise AssertionError(f"{name} must need the unlocked vault")
        except Exception as exc:
            check("锁定" in str(exc), f"{name} refuses while locked")
    check(service.totp_status()["enabled"] is True, "status is readable while locked")
    service.close()


def main() -> None:
    test_algorithm()
    for name, fn in (
        ("binding", test_binding),
        ("unlock", test_unlock),
        ("expiry", test_pending_expiry),
        ("disable", test_disable),
        ("recovery", test_recovery_and_backup),
        ("guards", test_cancel_and_locked_guard),
    ):
        tmp = Path(tempfile.mkdtemp(prefix=f"msv-totp-{name}-"))
        try:
            fn(tmp)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print("\nAll TOTP checks passed.")


if __name__ == "__main__":
    main()
