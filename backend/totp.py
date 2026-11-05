"""RFC 6238 TOTP, written against the standard library only.

The vault can require, next to the master password, a rolling 6-digit code from
an authenticator app (Google Authenticator, Microsoft Authenticator, FreeOTP,
…).  Nothing about this module talks to the network: a shared secret is
generated locally, shown as an `otpauth://` QR code once for enrolment, then
only kept sealed under the vault DEK.

Parameters follow the de-facto defaults every authenticator app supports, so
no vendor-specific extensions are used:

* HMAC-SHA1, 30 second period, 6 digits, 160-bit secret (RFC 4226 default)
* one step of drift in both directions, i.e. a code stays valid up to 60 s
* the exact (code, step) pair that last unlocked the vault is rejected, so a
  code cannot be replayed inside its own validity window

The test vectors in `tools/test_totp.py` come from Appendix B of RFC 6238.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import struct
import time
from urllib.parse import quote

ALGORITHM = "SHA1"
DIGITS = 6
PERIOD = 30
DRIFT_STEPS = 1
SECRET_BYTES = 20
PENDING_MINUTES = 15

_HASHES = {"SHA1": hashlib.sha1, "SHA256": hashlib.sha256, "SHA512": hashlib.sha512}
_B32_CLEAN = re.compile(r"[\s\-]+")
_B32_VALID = re.compile(r"^[A-Z2-7]+$")


def new_secret(length: int = SECRET_BYTES) -> str:
    """A fresh base32 secret, unpadded, as authenticator apps expect it."""
    return base64.b32encode(secrets.token_bytes(length)).decode("ascii").rstrip("=")


def decode_secret(secret: str) -> bytes:
    """Accept what a human can paste: spaces, dashes and lower case included."""
    raw = _B32_CLEAN.sub("", str(secret or "")).upper()
    if not raw:
        raise ValueError("验证码密钥为空")
    if not _B32_VALID.match(raw):
        raise ValueError("验证码密钥不是有效的 Base32")
    pad = "=" * ((8 - len(raw) % 8) % 8)
    try:
        return base64.b32decode(raw + pad, casefold=True)
    except Exception as exc:
        raise ValueError("验证码密钥不是有效的 Base32") from exc


def current_step(at: float | None = None, period: int = PERIOD) -> int:
    return int((time.time() if at is None else at) // period)


def code_at(secret: str, step: int, digits: int = DIGITS,
            algorithm: str = ALGORITHM) -> str:
    """One HOTP value: the dynamic truncation from RFC 4226 §5.3."""
    key = decode_secret(secret)
    mac = hmac.new(key, struct.pack(">Q", int(step)), _HASHES[algorithm]).digest()
    offset = mac[-1] & 0x0F
    binary = struct.unpack(">I", mac[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(binary % (10 ** digits)).zfill(digits)


def verify(secret: str, code: str, at: float | None = None, digits: int = DIGITS,
           period: int = PERIOD, drift: int = DRIFT_STEPS,
           algorithm: str = ALGORITHM) -> tuple[bool, int | None]:
    """Compare `code` against the window around now.

    Returns `(ok, matched_step)`; the matched step is what the caller stores to
    reject an exact replay.  Every candidate is compared, so the running time
    does not leak which offset hit.
    """
    candidate = re.sub(r"\D", "", str(code or ""))
    if len(candidate) != digits:
        return False, None
    step = current_step(at, period)
    matched: int | None = None
    for offset in range(-drift, drift + 1):
        want = code_at(secret, step + offset, digits, algorithm)
        if hmac.compare_digest(want, candidate):
            matched = step + offset
    return matched is not None, matched


def provisioning_uri(secret: str, account: str, issuer: str = "MedSafeVault",
                     digits: int = DIGITS, period: int = PERIOD,
                     algorithm: str = ALGORITHM) -> str:
    """The `otpauth://` string a QR code has to carry (Key Auth URI spec)."""
    label = quote(f"{issuer}:{account}", safe="")
    query = "&".join((
        f"secret={_B32_CLEAN.sub('', secret)}",
        f"issuer={quote(issuer, safe='')}",
        f"algorithm={algorithm}",
        f"digits={digits}",
        f"period={period}",
    ))
    return f"otpauth://totp/{label}?{query}"


def seconds_left(at: float | None = None, period: int = PERIOD) -> int:
    now = time.time() if at is None else at
    return int(period - (now % period))
