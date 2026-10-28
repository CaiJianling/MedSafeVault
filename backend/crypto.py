"""Cryptographic primitives for MedSafeVault.

Design
------
* A random 256-bit Data Encryption Key (DEK) encrypts every sensitive field.
* The master password never gets stored. It derives a Key Encryption Key (KEK)
  through PBKDF2-HMAC-SHA256 which only wraps the DEK.
* A randomly generated recovery code is a second independent KEK that wraps the
  same DEK. Losing the master password therefore never requires re-encrypting
  the data, and the recovery file can reset the password.
* Changing the master password only re-wraps the DEK; existing ciphertext and
  the whole encrypted history stay valid.

All AES-GCM tokens are authenticated and bound to an AAD purpose string.
"""
from __future__ import annotations

import base64
import hashlib
import secrets
import unicodedata
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

KEY_LEN = 32
NONCE_LEN = 12
KDF_ITERATIONS = 600_000
KDF_ALGORITHM = "PBKDF2-HMAC-SHA256"

AAD_FIELD = b"medsafe-vault/field/v1"
AAD_SECRET_FIELD = b"medsafe-vault/field-secret/v1"
AAD_DEK = b"medsafe-vault/dek/v1"
AAD_RECOVERY = b"medsafe-vault/recovery/v1"
AAD_VERIFIER = b"medsafe-vault/verifier/v1"

# Two ciphertext tiers share the same JSON column. "v1:" is the ordinary field
# key, "s1:" is derived from it through HKDF and only ever encrypts passwords,
# so a leaked row blob cannot be decrypted by the regular key alone.
TOKEN_PREFIX = "v1:"
SECRET_TOKEN_PREFIX = "s1:"
SECRET_SUBKEY_INFO = b"medsafe-vault/password-subkey/v1"
VERIFIER_PLAINTEXT = "MedSafeVault-dek-ok"

RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
RECOVERY_GROUPS = 8
RECOVERY_GROUP_LEN = 4
RECOVERY_CHARS = RECOVERY_GROUPS * RECOVERY_GROUP_LEN


class CryptoError(Exception):
    """Raised when a token cannot be decrypted or a key is invalid."""


def b64e(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def b64d(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def new_salt() -> bytes:
    return secrets.token_bytes(16)


def derive_kek(password: str, salt: bytes, iterations: int = KDF_ITERATIONS) -> bytes:
    if not isinstance(password, str) or not password:
        raise CryptoError("密码不能为空")
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=KEY_LEN,
        salt=salt,
        iterations=int(iterations),
    )
    return kdf.derive(password.encode("utf-8"))


def new_dek() -> bytes:
    return secrets.token_bytes(KEY_LEN)


def _seal_bytes(key: bytes, payload: bytes, aad: bytes,
                prefix: str = TOKEN_PREFIX) -> str:
    nonce = secrets.token_bytes(NONCE_LEN)
    ciphertext = AESGCM(key).encrypt(nonce, payload, aad)
    return prefix + b64e(nonce + ciphertext)


def token_prefix(token: Any) -> str | None:
    """Return the ciphertext tier of a token, or None when it is plaintext."""
    if not isinstance(token, str):
        return None
    if token.startswith(SECRET_TOKEN_PREFIX):
        return SECRET_TOKEN_PREFIX
    if token.startswith(TOKEN_PREFIX):
        return TOKEN_PREFIX
    return None


def is_secret_token(token: Any) -> bool:
    return token_prefix(token) == SECRET_TOKEN_PREFIX


def _open_bytes(key: bytes, token: str, aad: bytes,
                prefix: str | None = None) -> bytes:
    if not token or not isinstance(token, str):
        raise CryptoError("密文为空")
    known = prefix or token_prefix(token)
    if known is None:
        raise CryptoError("密文格式不正确")
    raw = b64d(token[len(known):])
    if len(raw) < NONCE_LEN + 16:
        raise CryptoError("密文长度不正确")
    try:
        return AESGCM(key).decrypt(raw[:NONCE_LEN], raw[NONCE_LEN:], aad)
    except Exception as exc:  # InvalidTag and friends
        raise CryptoError("解密失败，密钥不匹配或数据已损坏") from exc


def seal_text(key: bytes, text: str, aad: bytes = AAD_FIELD) -> str:
    return _seal_bytes(key, (text or "").encode("utf-8"), aad)


def open_text(key: bytes, token: str, aad: bytes = AAD_FIELD) -> str:
    if not token:
        return ""
    return _open_bytes(key, token, aad).decode("utf-8")


def derive_secret_key(dek: bytes) -> bytes:
    """Derive the password-tier subkey; it never touches the disk."""
    if len(dek) != KEY_LEN:
        raise CryptoError("数据密钥长度不正确")
    return HKDF(
        algorithm=hashes.SHA256(),
        length=KEY_LEN,
        salt=None,
        info=SECRET_SUBKEY_INFO,
    ).derive(dek)


def seal_field(dek: bytes, secret_dek: bytes | None, text: str,
               secret: bool = False) -> str:
    """Encrypt one field value, choosing the tier the column belongs to."""
    payload = (text or "").encode("utf-8")
    if secret:
        if not secret_dek:
            raise CryptoError("缺少密码专用密钥")
        return _seal_bytes(secret_dek, payload, AAD_SECRET_FIELD, SECRET_TOKEN_PREFIX)
    return _seal_bytes(dek, payload, AAD_FIELD, TOKEN_PREFIX)


def open_field(dek: bytes, secret_dek: bytes | None, token: Any) -> str:
    if not token:
        return ""
    if not isinstance(token, str):
        return ""
    prefix = token_prefix(token)
    if prefix is None:
        raise CryptoError("密文格式不正确")
    if prefix == SECRET_TOKEN_PREFIX:
        if not secret_dek:
            raise CryptoError("缺少密码专用密钥")
        return _open_bytes(secret_dek, token, AAD_SECRET_FIELD).decode("utf-8")
    return _open_bytes(dek, token, AAD_FIELD).decode("utf-8")


def wrap_dek(kek: bytes, dek: bytes) -> str:
    if len(dek) != KEY_LEN:
        raise CryptoError("数据密钥长度不正确")
    return _seal_bytes(kek, dek, AAD_DEK)


def unwrap_dek(kek: bytes, token: str) -> bytes:
    dek = _open_bytes(kek, token, AAD_DEK)
    if len(dek) != KEY_LEN:
        raise CryptoError("数据密钥长度不正确")
    return dek


def make_verifier(dek: bytes) -> str:
    return seal_text(dek, VERIFIER_PLAINTEXT, AAD_VERIFIER)


def check_verifier(dek: bytes, token: str) -> bool:
    try:
        return open_text(dek, token, AAD_VERIFIER) == VERIFIER_PLAINTEXT
    except CryptoError:
        return False


def new_recovery_code() -> str:
    chars = [secrets.choice(RECOVERY_ALPHABET) for _ in range(RECOVERY_CHARS)]
    groups = [
        "".join(chars[i:i + RECOVERY_GROUP_LEN])
        for i in range(0, RECOVERY_CHARS, RECOVERY_GROUP_LEN)
    ]
    return "-".join(groups)


def normalize_recovery_code(code: str) -> str:
    if not isinstance(code, str):
        raise CryptoError("恢复密钥格式不正确")
    text = unicodedata.normalize("NFKC", code).upper()
    text = "".join(ch for ch in text if ch.isalnum())
    if len(text) != RECOVERY_CHARS:
        raise CryptoError("恢复密钥长度不正确")
    if any(ch not in RECOVERY_ALPHABET for ch in text):
        raise CryptoError("恢复密钥包含无效字符")
    return "-".join(
        text[i:i + RECOVERY_GROUP_LEN]
        for i in range(0, RECOVERY_CHARS, RECOVERY_GROUP_LEN)
    )


def derive_recovery_kek(code: str, salt: bytes, iterations: int = KDF_ITERATIONS) -> bytes:
    normalized = normalize_recovery_code(code)
    return derive_kek(normalized, salt, iterations)


def wrap_for_recovery(code: str, salt: bytes, dek: bytes, iterations: int = KDF_ITERATIONS) -> str:
    kek = derive_recovery_kek(code, salt, iterations)
    return _seal_bytes(kek, dek, AAD_RECOVERY)


def unwrap_from_recovery(code: str, salt: bytes, token: str,
                         iterations: int = KDF_ITERATIONS) -> bytes:
    kek = derive_recovery_kek(code, salt, iterations)
    dek = _open_bytes(kek, token, AAD_RECOVERY)
    if len(dek) != KEY_LEN:
        raise CryptoError("数据密钥长度不正确")
    return dek


def random_password(length: int = 18, symbols: bool = True) -> str:
    """Generate a strong password using rejection-free secrets.choice."""
    length = max(8, min(int(length), 128))
    letters = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
    digits = "23456789"
    symbol_set = "!@#$%^&*()-_=+[]{};:,.?"
    alphabet = letters + digits + (symbol_set if symbols else "")
    # Guarantee at least one of each required class.
    required = [secrets.choice(letters), secrets.choice(digits)]
    if symbols:
        required.append(secrets.choice(symbol_set))
    rest = [secrets.choice(alphabet) for _ in range(max(0, length - len(required)))]
    chars = required + rest
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def password_score(password: str) -> int:
    """Return 0..4, deliberately conservative and dependency free."""
    if not password:
        return 0
    length = len(password)
    classes = sum([
        any(c.islower() for c in password),
        any(c.isupper() for c in password),
        any(c.isdigit() for c in password),
        any(not c.isalnum() for c in password),
    ])
    score = 0
    if length >= 8:
        score += 1
    if length >= 12:
        score += 1
    if length >= 16:
        score += 1
    if classes >= 3:
        score += 1
    if length < 8:
        score = min(score, 1)
    # Penalise obvious repetition.
    if len(set(password)) <= max(2, length // 4):
        score = min(score, 2)
    return min(score, 4)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
