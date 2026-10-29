"""Check that accent/danger filled controls stay readable in both themes.

    python tools/test_theme_contrast.py

Two layers:

1. Static: parse the accent palettes out of web/src/styles.css and compute the
   WCAG ratio between --msv-accent-contrast and both stops of the button
   gradient (and the danger pair), for every palette in light and dark.
2. Source scan: no component may put a hardcoded text colour on an accent or
   danger background again — that is how "white label on a bright blue button"
   slipped into the dark theme.
"""
from __future__ import annotations

import colorsys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = (ROOT / "web" / "src" / "styles.css").read_text(encoding="utf-8")
FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name} {detail}")
    if not ok:
        FAILURES.append(name)


def hsl_to_rgb(h: float, s: float, l: float) -> tuple[float, float, float]:
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, l / 100, s / 100)
    return (r * 255, g * 255, b * 255)


def rgb(value: str) -> tuple[float, float, float]:
    """'#rrggbb' or 'rgb(r, g, b)' -> floats."""
    if value.startswith("#"):
        return tuple(float(int(value[i:i + 2], 16)) for i in (1, 3, 5))  # type: ignore[return-value]
    parts = [float(x) for x in re.findall(r"[0-9.]+", value)[:3]]
    return (parts[0], parts[1], parts[2])


def luminance(color: tuple[float, float, float]) -> float:
    def channel(c: float) -> float:
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = color
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def ratio(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    l1, l2 = luminance(a), luminance(b)
    return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)


PALETTES = {
    name: {key: float(value.rstrip("%")) for key, value in re.findall(r"--msv-([\w-]+):\s*([\d.]+%?)", body)}
    for name, body in re.findall(r"\[data-accent='(\w+)'\]\s*\{(.*?)\}", CSS, re.S)
    if "h" in body
}

print(f"[1] palettes found: {', '.join(sorted(PALETTES))}")
check("every palette is defined", len(PALETTES) >= 8, f"got {len(PALETTES)}")

print("[2] accent-filled buttons (label + icon on the gradient)")
for name, tokens in sorted(PALETTES.items()):
    h, s = tokens["h"], tokens["s"]
    for theme, fill_key, contrast_for_theme in (
        ("light", "l-fill", (255, 255, 255)),          # --msv-accent-contrast in light
        ("dark", "d-fill", hsl_to_rgb(h, 62, 7)),      # --msv-accent-contrast in dark
    ):
        fill = tokens[fill_key]
        strong = fill - 7 if theme == "light" else fill + 12
        worst = min(ratio(contrast_for_theme, hsl_to_rgb(h, s, fill)),
                    ratio(contrast_for_theme, hsl_to_rgb(h, s, strong)))
        check(f"{theme:5} {name:8} label on button", worst >= 4.5, f"{worst:.2f}:1")

print("[3] danger buttons (the --danger / --danger-foreground pair)")
pairs = re.findall(r"--danger:\s*(#[0-9a-fA-F]{6});.*?--danger-foreground:\s*(#[0-9a-fA-F]{6});", CSS, re.S)
check("both themes declare the danger pair", len(pairs) >= 2, f"got {len(pairs)}")
for (bg_hex, fg_hex), theme in zip(pairs, ("light", "dark")):
    bg, fg = rgb(bg_hex), rgb(fg_hex)
    check(f"{theme:5} danger button", ratio(bg, fg) >= 4.5, f"{ratio(bg, fg):.2f}:1")

print("[4] components must use the tokens, not hardcoded text colours")
offenders = []
for path in (ROOT / "web" / "src").rglob("*.tsx"):
    text = path.read_text(encoding="utf-8")
    for match in re.finditer(r"bg-\[var\(--(?:msv-accent|danger)\)\][^'\"`]*", text):
        chunk = match.group(0)
        if "text-white" in chunk or "text-[#" in chunk:
            offenders.append(f"{path.name}: {chunk[:70]}")
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
