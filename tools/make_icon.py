"""Generate the application icon (original artwork, drawn with Pillow)."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "assets"
OUT.mkdir(parents=True, exist_ok=True)

SIZE = 512


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def build(size: int) -> Image.Image:
    scale = size / SIZE
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    top = (37, 99, 235)      # deep azure
    bottom = (14, 165, 233)  # cyan highlight
    radius = 0.235 * size

    # Rounded-square badge with a vertical gradient, painted row by row.
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    gradient = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for y in range(size):
        row = Image.new("RGBA", (size, 1), lerp(top, bottom, y / max(1, size - 1)) + (255,))
        gradient.paste(row, (0, y))
    img.paste(gradient, (0, 0), mask)

    # Soft top sheen so the badge does not read as flat.
    sheen = Image.new("L", (size, size), 0)
    ImageDraw.Draw(sheen).ellipse(
        [-size * 0.35, -size * 0.62, size * 1.35, size * 0.42], fill=46
    )
    sheen = Image.composite(sheen, Image.new("L", (size, size), 0), mask)
    white = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    img = Image.alpha_composite(img, Image.composite(white, Image.new("RGBA", (size, size), (0, 0, 0, 0)), sheen))

    draw = ImageDraw.Draw(img)
    cx = size * 0.5
    # Shield outline: the "vault" idea, drawn as a rounded crest.
    shield_w, shield_h = size * 0.44, size * 0.52
    top_y = size * 0.20
    points = [
        (cx, top_y),
        (cx + shield_w / 2, top_y + shield_h * 0.16),
        (cx + shield_w / 2, top_y + shield_h * 0.55),
        (cx, top_y + shield_h),
        (cx - shield_w / 2, top_y + shield_h * 0.55),
        (cx - shield_w / 2, top_y + shield_h * 0.16),
    ]
    draw.polygon(points, fill=(255, 255, 255, 236))

    # Keyhole cut-out in the shield.
    hole_r = size * 0.075
    hole_cy = top_y + shield_h * 0.40
    stem_w = size * 0.052
    stem_top = hole_cy
    stem_bottom = top_y + shield_h * 0.74
    draw.ellipse(
        [cx - hole_r, hole_cy - hole_r, cx + hole_r, hole_cy + hole_r],
        fill=(15, 42, 84, 255),
    )
    draw.polygon(
        [
            (cx - stem_w, stem_top),
            (cx + stem_w, stem_top),
            (cx + stem_w * 1.45, stem_bottom),
            (cx - stem_w * 1.45, stem_bottom),
        ],
        fill=(15, 42, 84, 255),
    )

    # Hairline rim for definition on light taskbars.
    draw.rounded_rectangle(
        [0.5, 0.5, size - 1.5, size - 1.5], radius=radius, outline=(255, 255, 255, 60), width=max(1, size // 128)
    )
    return img


master = build(SIZE)
master.save(OUT / "app.png")
master.save(OUT / "app.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("wrote", OUT / "app.ico", "and", OUT / "app.png")
