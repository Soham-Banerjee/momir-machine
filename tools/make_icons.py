#!/usr/bin/env python3
"""Draw the app icons (a receipt with an M on it). Needs Pillow: pip install pillow.
Edit the colours or shapes below and re-run to restyle."""
from pathlib import Path
from PIL import Image, ImageDraw

BG, PAPER, INK, ACCENT = "#14110f", "#f5f0e3", "#cfc6b4", "#e3a335"
OUT = Path(__file__).resolve().parent.parent / "docs"
S = 1024  # draw large, then shrink for smooth edges


def draw():
    img = Image.new("RGB", (S, S), BG)   # full-bleed background so the icon can be masked to any shape
    d = ImageDraw.Draw(img)
    # Everything important stays inside the central 80% ("safe zone" for maskable icons).
    left, right, top, bottom = int(S * .30), int(S * .70), int(S * .16), int(S * .80)
    tooth, step = int(S * .03), int(S * .04)
    zig = [(left, bottom)]
    x, up = left, False
    while x < right:
        x = min(x + step, right)
        zig.append((x, bottom - (tooth if up else 0)))
        up = not up
    d.polygon([(left, top), (right, top), *reversed(zig)], fill=PAPER)

    # "M" in the accent colour
    w = int(S * .035)
    mx0, mx1, my0, my1 = int(S * .37), int(S * .63), int(S * .26), int(S * .44)
    mid = ((mx0 + mx1) // 2, my1 - int(S * .06))
    d.line([(mx0, my1), (mx0, my0), mid, (mx1, my0), (mx1, my1)], fill=ACCENT, width=w, joint="curve")

    # grey "text" lines
    for i, frac in enumerate((1.0, .85, 1.0, .6)):
        y = int(S * (.52 + i * .06))
        d.rounded_rectangle([left + int(S * .04), y, left + int(S * .04) + int((right - left - int(S * .08)) * frac), y + int(S * .022)],
                            radius=int(S * .01), fill=INK)
    return img


if __name__ == "__main__":
    big = draw()
    for size in (192, 512):
        big.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png", optimize=True)
        print("wrote", OUT / f"icon-{size}.png")
