"""Generate claude-manager app icon: rounded square gradient + sparkle glyph."""
from PIL import Image, ImageDraw, ImageFilter
import os
import math

OUT = os.path.dirname(os.path.abspath(__file__))

# Brand gradient: indigo-600 (#4f46e5) → violet-700 (#6d28d9) → fuchsia-600 (#c026d3)
COLOR_TOP = (99, 102, 241)        # indigo-500
COLOR_BOTTOM = (139, 92, 246)     # violet-500
ACCENT = (244, 232, 255)          # near-white violet
BADGE_FG = (255, 255, 255, 255)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    for y in range(size):
        t = y / size
        c = lerp(COLOR_TOP, COLOR_BOTTOM, t)
        for x in range(size):
            # slight diagonal tint
            dx = x / size
            r = int(c[0] + (dx * 12 - 6))
            g = int(c[1] + (dx * 4 - 2))
            b = int(c[2] + (dx * 20 - 10))
            px[x, y] = (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)), 255)
    return img


def rounded_mask(size, radius_ratio=0.22):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    r = int(size * radius_ratio)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=255)
    return mask


def add_glow(img, size):
    """Subtle inner highlight at top for depth."""
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    h = int(size * 0.45)
    for i in range(h):
        alpha = int(70 * (1 - i / h) ** 1.5)
        d.line([(0, i), (size, i)], fill=(255, 255, 255, alpha))
    return Image.alpha_composite(img, overlay)


def draw_sparkle(img, size):
    """Four-pointed sparkle (a.k.a. AI/magic glyph) centered."""
    d = ImageDraw.Draw(img, "RGBA")
    cx, cy = size / 2, size / 2
    # main sparkle
    main_radius = size * 0.30
    cross_w = size * 0.07
    # vertical diamond
    d.polygon(
        [
            (cx, cy - main_radius),
            (cx + cross_w, cy),
            (cx, cy + main_radius),
            (cx - cross_w, cy),
        ],
        fill=(255, 255, 255, 255),
    )
    # horizontal diamond
    d.polygon(
        [
            (cx - main_radius, cy),
            (cx, cy - cross_w),
            (cx + main_radius, cy),
            (cx, cy + cross_w),
        ],
        fill=(255, 255, 255, 255),
    )
    # small accent sparkle top-right
    sr = size * 0.10
    scw = size * 0.025
    sx, sy = cx + size * 0.25, cy - size * 0.25
    d.polygon(
        [(sx, sy - sr), (sx + scw, sy), (sx, sy + sr), (sx - scw, sy)],
        fill=(255, 255, 255, 220),
    )
    d.polygon(
        [(sx - sr, sy), (sx, sy - scw), (sx + sr, sy), (sx, sy + scw)],
        fill=(255, 255, 255, 220),
    )
    # tiny accent bottom-left
    sr = size * 0.07
    scw = size * 0.017
    sx, sy = cx - size * 0.27, cy + size * 0.26
    d.polygon(
        [(sx, sy - sr), (sx + scw, sy), (sx, sy + sr), (sx - scw, sy)],
        fill=(255, 255, 255, 190),
    )
    d.polygon(
        [(sx - sr, sy), (sx, sy - scw), (sx + sr, sy), (sx, sy + scw)],
        fill=(255, 255, 255, 190),
    )
    return img


def make_icon(size, rounded=True):
    grad = gradient(size)
    grad = add_glow(grad, size)
    icon = draw_sparkle(grad, size)
    if rounded:
        mask = rounded_mask(size)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(icon, (0, 0), mask)
        return out
    return icon


SIZES = [16, 32, 64, 128, 256, 512, 1024]
for s in SIZES:
    img = make_icon(s)
    if s == 32:
        img.save(os.path.join(OUT, "32x32.png"))
    elif s == 128:
        img.save(os.path.join(OUT, "128x128.png"))
    elif s == 256:
        img.save(os.path.join(OUT, "128x128@2x.png"))
    elif s == 512:
        img.save(os.path.join(OUT, "icon.png"))
    # Also save raw size for iconset
    img.save(os.path.join(OUT, f"_raw_{s}.png"))

# Windows .ico
ico_img = make_icon(256)
ico_img.save(
    os.path.join(OUT, "icon.ico"),
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

print("PNG icons + ICO generated")
