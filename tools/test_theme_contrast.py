"""Check that accent/danger filled controls stay readable in both themes.

    python tools/test_theme_contrast.py

Two layers:

1. Static: parse the accent palettes *and* the derived ``--msv-accent-solid``
   tokens out of web/src/styles.css, resolve them the same way the browser
   would, and compute the WCAG ratio between the label colour and both stops of
   the button gradient — for every palette in light and dark.  The dark theme
   picks its own solid lightness/label per palette (blue, violet and rose get a
   white label; the pale palettes keep a dark one), so the test reads those
   overrides from the stylesheet instead of assuming one rule for all hues.
2. Source scan: no component may put a hardcoded text colour on a themed fill
   again — that is how "white label on a bright cyan button" slipped in.
"""
from __future__ import annotations

import colorsys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = (ROOT / "web" / "src" / "styles.css").read_text(encoding="utf-8")
FAILURES: list[str] = []
AA = 4.5


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name} {detail}")
    if not ok:
        FAILURES.append(name)


def body(selector: str) -> str:
    """Declaration block that follows `selector` verbatim."""
    match = re.search(re.escape(selector) + r"\s*\{(.*?)\}", CSS, re.S)
    if not match:
        raise SystemExit(f"styles.css: block for {selector!r} not found")
    return match.group(1)


def hsl_to_rgb(h: float, s: float, l: float) -> tuple[float, float, float]:
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, l / 100, s / 100)
    return (r * 255, g * 255, b * 255)


def rgb(value: str) -> tuple[float, float, float]:
    """'#rrggbb' -> floats."""
    return tuple(float(int(value[i:i + 2], 16)) for i in (1, 3, 5))  # type: ignore[return-value]


def luminance(color: tuple[float, float, float]) -> float:
    def channel(c: float) -> float:
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = color
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def ratio(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    l1, l2 = luminance(a), luminance(b)
    return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)


def num(text: str, token: str) -> float:
    """Value of `--msv-x: 12.3%` inside an already captured block."""
    match = re.search(rf"--{re.escape(token)}:\s*(-?[\d.]+)%?[;]", text)
    if not match:
        raise SystemExit(f"styles.css: {token} missing")
    return float(match.group(1))


def resolve_color(value: str, h: float) -> tuple[float, float, float]:
    """A label token value -> rgb, resolving hsl(var(--msv-h), s, l)."""
    value = value.strip()
    if value.startswith("#"):
        return rgb(value)
    match = re.match(r"hsl\(\s*var\(--msv-h\)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)", value)
    if not match:
        raise SystemExit(f"styles.css: cannot resolve label colour {value!r}")
    return hsl_to_rgb(h, float(match.group(1)), float(match.group(2)))


# ---------------------------------------------------------------- palettes

PALETTES = {
    name: {key: num(block, f"msv-{key}") for key in ("h", "s", "l-text", "l-fill", "d-text", "d-fill")}
    for name, block in re.findall(r"(?<![\w.])\[data-accent='(\w+)'\]\s*\{(.*?)\}", CSS, re.S)
    if "--msv-h" in block
}

# Per-theme defaults for the filled-control tokens, read from the stylesheet.
LIGHT_SOLID = body(":root,\n[data-accent]")
DARK_SOLID = body(".dark,\n.dark [data-accent]")
DARK_OVERRIDES = {
    name: block
    for name, block in re.findall(r"\.dark\[data-accent='(\w+)'\]\s*\{(.*?)\}", CSS, re.S)
}

WHITE = (255.0, 255.0, 255.0)


def gradient(name: str, theme: str) -> tuple[tuple, tuple, tuple]:
    """Resolve the two gradient stops and the label colour the browser would use.

    Mirrors the derivations in styles.css: the light theme keeps `--msv-s`
    plain and pulls the strong stop 7% darker, the dark theme adds 4%/6%
    saturation and pushes the strong stop lighter by `--msv-solid-shift`.
    """
    tokens = PALETTES[name]
    h, s = tokens["h"], tokens["s"]
    if theme == "light":
        block, fill_key, base, strong = LIGHT_SOLID, "l-fill", s, s + 4
    else:
        block, fill_key, base, strong = DARK_SOLID, "d-fill", s + 4, s + 6
        if name in DARK_OVERRIDES:
            block = DARK_OVERRIDES[name]
    shift = num(block, "msv-solid-shift")
    match = re.search(r"--msv-solid-l:\s*(-?[\d.]+)%?[;]", block)
    fill = float(match.group(1)) if match else tokens[fill_key]
    label = resolve_color(re.search(r"--msv-solid-fg:\s*([^;]+);", block).group(1), h)  # type: ignore[union-attr]
    return hsl_to_rgb(h, strong, fill + shift), hsl_to_rgb(h, base, fill), label


print(f"[1] palettes found: {', '.join(sorted(PALETTES))}")
check("every palette is defined", len(PALETTES) >= 8, f"got {len(PALETTES)}")
check("dark theme overrides only the deep hues",
      set(DARK_OVERRIDES) <= {"blue", "violet", "rose"},
      f"got {sorted(DARK_OVERRIDES)}")

print("[2] filled accent controls (label + icon on the button gradient)")
for name in sorted(PALETTES):
    for theme in ("light", "dark"):
        strong, solid, label = gradient(name, theme)
        worst = min(ratio(label, solid), ratio(label, strong))
        hue_word = "light" if luminance(label) > 0.5 else "dark"
        check(f"{theme:5} {name:8} {hue_word:5} label", worst >= AA, f"{worst:.2f}:1")

print("[3] the pale dark palettes must keep the dark label (white would fail)")
for name in sorted(set(PALETTES) - set(DARK_OVERRIDES)):
    tokens = PALETTES[name]
    fill = tokens["d-fill"]
    strong = hsl_to_rgb(tokens["h"], tokens["s"] + 6, fill + num(DARK_SOLID, "msv-solid-shift"))
    solid = hsl_to_rgb(tokens["h"], tokens["s"] + 4, fill)
    worst_white = min(ratio(WHITE, solid), ratio(WHITE, strong))
    check(f"dark   {name:8} white rejected", worst_white < AA, f"{worst_white:.2f}:1")

print("[3b] the dark overrides stay soft white, not pure #fff (it glares on a dark panel)")
for name in sorted(DARK_OVERRIDES):
    _, _, label = gradient(name, "dark")
    lum = luminance(label)
    check(f"dark   {name:8} soft label", 0.8 < lum < 1.0, f"luminance {lum:.3f} = {tuple(round(c) for c in label)}")

print("[4] danger buttons (the --danger / --danger-foreground pair)")
pairs = re.findall(r"--danger:\s*(#[0-9a-fA-F]{6});.*?--danger-foreground:\s*(#[0-9a-fA-F]{6});", CSS, re.S)
check("both themes declare the danger pair", len(pairs) >= 2, f"got {len(pairs)}")
for (bg_hex, fg_hex), theme in zip(pairs, ("light", "dark")):
    bg, fg = rgb(bg_hex), rgb(fg_hex)
    check(f"{theme:5} danger button", ratio(bg, fg) >= AA, f"{ratio(bg, fg):.2f}:1")

print("[6] text ramp on the real panels (main copy must read as near-white in dark)")
RAMP = {  # token -> floor ratio against the panel it is normally painted on
    "msv-ice-200": 13.0,   # headings, table cells, inputs
    "msv-ice-300": 10.0,   # body text, hovered icons
    "msv-ice-400": 7.5,    # secondary labels
    "msv-ice-500": 6.0,    # table header captions
    "msv-ice-600": 4.5,    # muted hints, placeholders
}
for theme, block in (("light", body(":root")), ("dark", body(".dark"))):
    surface = rgb(re.search(r"--msv-surface:\s*(#[0-9a-fA-F]{6})", block).group(1))
    head = rgb(re.search(r"--msv-table-head:\s*(#[0-9a-fA-F]{6})", block).group(1))
    for token, floor in RAMP.items():
        match = re.search(rf"--{token}:\s*(#[0-9a-fA-F]{{6}})", block)
        if not match:
            continue
        bg = head if token == "msv-ice-500" else surface
        where = "head " if token == "msv-ice-500" else "panel"
        got = ratio(rgb(match.group(1)), bg)
        check(f"{theme:5} {token:12} {where}", got >= floor, f"{got:.2f}:1 (floor {floor}:1)")

print("[7] components must use the tokens, not hardcoded text colours")
offenders = []
for path in (ROOT / "web" / "src").rglob("*.tsx"):
    text = path.read_text(encoding="utf-8")
    for match in re.finditer(r"bg-\[var\(--(?:msv-accent[\w-]*|danger|success|warning)\)\][^'\"`]*", text):
        chunk = match.group(0)
        if "text-white" in chunk or "text-[#" in chunk:
            offenders.append(f"{path.name}: {chunk[:70]}")
        if "msv-accent-solid" in chunk and "solid-fg" not in chunk and "text-" in chunk:
            offenders.append(f"{path.name}: label not from --msv-accent-solid-fg -> {chunk[:70]}")
    for match in re.finditer(r"bg-(?:rose|red|teal|sky|cyan|emerald|violet|amber)-(?:500|600)[^'\"`]*", text):
        chunk = match.group(0)
        if "text-white" in chunk:
            offenders.append(f"{path.name}: {chunk[:70]}")
check("no hardcoded label on a themed fill", not offenders, "; ".join(offenders[:4]))

print()
if FAILURES:
    print(f"{len(FAILURES)} check(s) failed")
    raise SystemExit(1)
print("All theme-contrast checks passed.")
