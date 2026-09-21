#!/usr/bin/env python3
"""Renders public/og-image.png (1200x630) for social previews.

Run:  python3 tools/make-og.py
No third-party assets: uses fonts already on macOS and PIL primitives only.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "og-image.png"

BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REG = "/System/Library/Fonts/Supplemental/Arial.ttf"

BG = (255, 255, 255)
INK = (0, 0, 0)
MUTED = (110, 110, 115)
RED = (255, 59, 48)
GREEN = (52, 199, 89)
BUBBLE = (232, 232, 237)

PAD = 88


def font(path, size):
    return ImageFont.truetype(path, size)


def text(d, xy, s, f, fill):
    d.text(xy, s, font=f, fill=fill)


def wrap(d, s, f, max_w):
    words, lines, cur = s.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if d.textlength(trial, font=f) <= max_w:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def bubble(d, x, y, w, h, fill, radius=12):
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill)


def main():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # --- header: mark + wordmark -------------------------------------------
    mark = 76
    d.rounded_rectangle([PAD, PAD, PAD + mark, PAD + mark], radius=17, fill=INK)
    # bubble outline inside the mark
    bx, by, bw, bh = PAD + 15, PAD + 17, mark - 30, mark - 38
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=7, outline=BG, width=4)
    d.polygon(
        [(bx + 10, by + bh), (bx + 10, by + bh + 12), (bx + 24, by + bh)],
        fill=INK,
    )
    d.line([bx + 9, by + bh - 6, bx + bw - 9, by + 8], fill=RED, width=6)

    f_h1 = font(BOLD, 92)
    text(d, (PAD + mark + 28, PAD - 12), "no bot reply.", f_h1, INK)

    # --- tagline -----------------------------------------------------------
    f_tag = font(REG, 40)
    tag = "Stop sending AI-written replies under your own name."
    y = PAD + mark + 44
    for line in wrap(d, tag, f_tag, W - PAD * 2 - 10):
        text(d, (PAD, y), line, f_tag, MUTED)
        y += 54

    # --- chat mock: slop vs human -----------------------------------------
    y += 22
    f_user = font(BOLD, 21)
    f_time = font(REG, 18)
    f_msg = font(REG, 23)

    def msg_row(top, name, stamp, body, bad):
        """Returns the y of the next row."""
        ax = PAD
        bubble(d, ax, top, 40, 40, BUBBLE)
        d.ellipse([ax + 12, top + 8, ax + 28, top + 24], fill=(140, 148, 160))
        d.rounded_rectangle([ax + 8, top + 26, ax + 32, top + 44], radius=7, fill=(140, 148, 160))

        tx = ax + 56
        text(d, (tx, top + 3), name, f_user, INK)
        text(d, (tx + f_user.getlength(name) + 12, top + 7), stamp, f_time, MUTED)
        text(d, (tx, top + 30), body, f_msg, INK if not bad else MUTED)
        return top + 40 + 30

    # bad row: the wall of text, truncated
    d.ellipse([PAD, y + 2, PAD + 22, y + 24], fill=GREEN)
    d.line([PAD + 7, y + 13, PAD + 10, y + 17], fill=BG, width=3)
    d.line([PAD + 10, y + 17, PAD + 16, y + 8], fill=BG, width=3)
    text(d, (PAD + 36, y), '"thursday, i think. sarah owns it"', f_msg, INK)

    y += 62

    # red x for the bad row above it, drawn as a label
    d.ellipse([PAD, y + 2, PAD + 22, y + 24], fill=RED)
    d.line([PAD + 7, y + 8, PAD + 16, y + 18], fill=BG, width=3)
    d.line([PAD + 16, y + 8, PAD + 7, y + 18], fill=BG, width=3)
    text(d, (PAD + 36, y), '"Great question! Thanks so much for reaching', f_msg, MUTED)
    y += 34
    text(d, (PAD + 36, y), "out. The exact due date depends on a number of", f_msg, MUTED)
    y += 34
    text(d, (PAD + 36, y), 'factors that are worth walking through..."', f_msg, MUTED)

    # --- footer ------------------------------------------------------------
    f_foot = font(BOLD, 22)
    text(d, (PAD, H - PAD - 22), "nobotreply.com", f_foot, INK)
    f_small = font(REG, 22)
    note = "Write something real, or say nothing at all."
    d.text((W - PAD - d.textlength(note, font=f_small), H - PAD - 22), note, font=f_small, fill=MUTED)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"  ✓ {OUT.relative_to(ROOT)}  {OUT.stat().st_size / 1024:.1f} KB  {W}x{H}")


if __name__ == "__main__":
    main()
