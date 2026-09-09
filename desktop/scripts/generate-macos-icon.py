#!/usr/bin/env python3
"""Render a Grok app icon: cropped glyph, 3D lighting, transparent squircle corners.

Usage:
  python3 scripts/generate-macos-icon.py
  npx tauri icon src-tauri/icons/icon-1024.png
"""

from __future__ import annotations

import io
import os
import re
import sys
from pathlib import Path

os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = "/opt/homebrew/lib:" + os.environ.get(
    "DYLD_FALLBACK_LIBRARY_PATH", ""
)

import cairosvg
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SVG_PATH = ROOT / "public" / "grok.svg"
_args = [a for a in sys.argv[1:] if not a.startswith("-")]
OUT_DIR = Path(_args[0]) if _args else ROOT / "src-tauri" / "icons"

WORK = 2048
FINAL = 1024
# Larger side of the glyph bbox, as a fraction of the tile.
COVERAGE = 0.80
# Squircle size as a fraction of the canvas. <1 leaves transparent padding.
TILE = 0.88


def load_glyph_path() -> str:
    svg = SVG_PATH.read_text()
    match = re.search(r'fill="#fff" d="([^"]+)"', svg)
    if not match:
        raise RuntimeError("Could not find Grok glyph path in grok.svg")
    return match.group(1)


def render_glyph_mask(size: int) -> np.ndarray:
    path = load_glyph_path()
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 509.641" '
        f'width="{size}" height="{size}">'
        f'<path fill="#ffffff" d="{path}"/></svg>'
    )
    png = cairosvg.svg2png(bytestring=svg.encode("utf-8"))
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    alpha = np.array(img, dtype=np.float32)[:, :, 3] / 255.0
    ys, xs = np.where(alpha > 0.02)
    crop = alpha[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    ch, cw = crop.shape
    target = int(round(size * COVERAGE))
    if cw >= ch:
        nw, nh = target, max(1, int(round(target * ch / cw)))
    else:
        nh, nw = target, max(1, int(round(target * cw / ch)))
    resized = Image.fromarray((np.clip(crop, 0, 1) * 255).astype(np.uint8), "L").resize(
        (nw, nh), Image.Resampling.LANCZOS
    )
    canvas = np.zeros((size, size), dtype=np.float32)
    y = (size - nh) // 2
    x = (size - nw) // 2
    canvas[y : y + nh, x : x + nw] = np.array(resized, dtype=np.float32) / 255.0
    return canvas


def blur(mask: np.ndarray, radius: float) -> np.ndarray:
    if radius <= 0:
        return mask
    img = Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8), "L")
    img = img.filter(ImageFilter.GaussianBlur(radius=radius))
    return np.array(img, dtype=np.float32) / 255.0


def shift(arr: np.ndarray, dy: int, dx: int) -> np.ndarray:
    out = np.zeros_like(arr)
    h, w = arr.shape[:2]
    y0s, y1s = max(0, -dy), min(h, h - dy)
    x0s, x1s = max(0, -dx), min(w, w - dx)
    y0d, x0d = max(0, dy), max(0, dx)
    y1d = y0d + (y1s - y0s)
    x1d = x0d + (x1s - x0s)
    if y1d > y0d and x1d > x0d:
        out[y0d:y1d, x0d:x1d] = arr[y0s:y1s, x0s:x1s]
    return out


def background(size: int) -> np.ndarray:
    """Dark space-gray tile with studio lighting. Full square, no rounded rect."""
    y = np.linspace(0.0, 1.0, size, dtype=np.float32)
    x = np.linspace(0.0, 1.0, size, dtype=np.float32)
    xx, yy = np.meshgrid(x, y)

    top = np.array([46, 46, 52], dtype=np.float32) / 255.0
    bot = np.array([6, 6, 8], dtype=np.float32) / 255.0
    t = yy ** 0.82
    bg = top * (1.0 - t)[..., None] + bot * t[..., None]

    # Key light, upper-left
    r = np.sqrt((xx - 0.34) ** 2 + (yy - 0.14) ** 2 * 0.78)
    key = np.clip(1.0 - r / 0.92, 0.0, 1.0) ** 1.55
    bg = bg + key[..., None] * np.array([0.15, 0.15, 0.16], dtype=np.float32)

    # Cool fill from the right
    rf = np.sqrt((xx - 0.96) ** 2 * 0.45 + (yy - 0.38) ** 2)
    fill = np.clip(1.0 - rf / 0.75, 0.0, 1.0) ** 2.0
    bg = bg + fill[..., None] * np.array([0.03, 0.035, 0.05], dtype=np.float32)

    # Slightly convex dome
    dome = np.exp(-(((xx - 0.46) ** 2) / 0.58 + ((yy - 0.30) ** 2) / 0.42))
    bg = bg + dome[..., None] * np.array([0.065, 0.065, 0.07], dtype=np.float32)

    # Top glass specular — this is what reads as 3D after macOS squircles the tile
    spec = np.exp(-((yy / 0.075) ** 2)) * (0.50 + 0.50 * np.exp(-(((xx - 0.48) / 0.58) ** 2)))
    bg = bg + spec[..., None] * np.array([0.28, 0.28, 0.29], dtype=np.float32)

    # Secondary sheen band
    sheen = np.clip(1.0 - np.abs(yy - 0.11) / 0.10, 0.0, 1.0) ** 1.4
    sheen = sheen * np.exp(-(((xx - 0.42) / 0.70) ** 2))
    bg = bg + sheen[..., None] * np.array([0.065, 0.065, 0.07], dtype=np.float32)

    # Bottom ambient occlusion
    ao = np.clip((yy - 0.52) / 0.48, 0.0, 1.0) ** 1.35
    bg = bg * (1.0 - 0.32 * ao)[..., None]

    # Edge falloff so the masked squircle still feels dimensional
    vig = 1.0 - 0.16 * ((xx - 0.5) ** 2 + (yy - 0.52) ** 2) * 4.0
    bg = bg * vig[..., None]

    rng = np.random.default_rng(7)
    fine = rng.normal(0.0, 0.010, (size, size)).astype(np.float32)
    streak = rng.normal(0.0, 0.022, (size, 1)).astype(np.float32)
    streak = np.repeat(streak, size, axis=1)
    streak = blur(streak, 7.0)
    bg = bg + (0.62 * fine + 0.38 * streak)[..., None]

    return np.clip(bg, 0.0, 1.0)


def composite_glyph(bg: np.ndarray, mask: np.ndarray) -> np.ndarray:
    size = mask.shape[0]
    s = size / 1024.0
    yy = np.linspace(0.0, 1.0, size, dtype=np.float32)[:, None]

    # Diffuse drop shadow
    shadow = blur(mask, 30 * s)
    shadow = shift(shadow, int(22 * s), int(8 * s))
    out = bg * (1.0 - 0.58 * shadow)[..., None]

    # Tight contact shadow
    contact = blur(mask, 8 * s)
    contact = shift(contact, int(8 * s), int(3 * s))
    out = out * (1.0 - 0.40 * contact)[..., None]

    # Short extrusion / thickness
    depth = max(1, int(8 * s))
    for i in range(depth, 0, -1):
        layer = shift(mask, i, max(1, i // 2))
        shade = 0.07 + 0.10 * (1.0 - i / depth)
        col = np.array([shade, shade, shade + 0.02], dtype=np.float32)
        a = layer[..., None]
        out = out * (1.0 - a) + col * a

    # Soft bloom so the mark lifts off the tile
    bloom = blur(mask, 18 * s)
    out = out + bloom[..., None] * np.array([0.07, 0.07, 0.09], dtype=np.float32)

    # Face: cool white enamel with a vertical grade
    face_top = np.array([1.00, 1.00, 1.00], dtype=np.float32)
    face_bot = np.array([0.86, 0.86, 0.89], dtype=np.float32)
    face = face_top * (1.0 - yy) + face_bot * yy

    # Bevel: top-left highlight, bottom-right inner shadow
    hi = np.clip(mask - shift(mask, int(6 * s), int(6 * s)), 0.0, 1.0)
    hi = blur(hi, 1.6 * s)
    lo = np.clip(mask - shift(mask, -int(5 * s), -int(5 * s)), 0.0, 1.0)
    lo = blur(lo, 1.8 * s)
    face = face + hi[..., None] * 0.42 - lo[..., None] * 0.22

    # Specular streak along the comet
    spec = blur(hi * mask, 3.5 * s)
    face = face + spec[..., None] * 0.18

    face = np.clip(face, 0.0, 1.0)
    a = mask[..., None]
    out = out * (1.0 - a) + face * a
    return np.clip(out, 0.0, 1.0)


def squircle_mask(size: int, n: float = 5.0) -> np.ndarray:
    x = np.linspace(-1.0, 1.0, size, dtype=np.float32)
    xx, yy = np.meshgrid(x, x)
    m = np.abs(xx) ** n + np.abs(yy) ** n
    # Anti-aliased edge around the superellipse
    width = 2.0 / size * 1.6
    inside = 1.0 - m
    return np.clip(0.5 + inside / width, 0.0, 1.0)


def to_image(arr: np.ndarray) -> Image.Image:
    u8 = (np.clip(arr, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    return Image.fromarray(u8, "RGB")


def to_rgba(rgb: np.ndarray, alpha: np.ndarray) -> Image.Image:
    u8 = (np.clip(rgb, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    a8 = (np.clip(alpha, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    return Image.fromarray(np.dstack([u8, a8]), "RGBA")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mask = render_glyph_mask(WORK)
    bg = background(WORK)
    art = composite_glyph(bg, mask)
    tile = to_rgba(art, squircle_mask(WORK)).resize((FINAL, FINAL), Image.Resampling.LANCZOS)
    inner = max(1, int(round(FINAL * TILE)))
    master = Image.new("RGBA", (FINAL, FINAL), (0, 0, 0, 0))
    scaled = tile.resize((inner, inner), Image.Resampling.LANCZOS)
    off = (FINAL - inner) // 2
    master.paste(scaled, (off, off), scaled)

    master_path = OUT_DIR / "icon-1024.png"
    master.save(master_path, "PNG")

    if "--preview" in sys.argv:
        rgba = np.array(master, dtype=np.float32) / 255.0
        rgb, a = rgba[..., :3], rgba[..., 3]
        board = np.full((FINAL, FINAL, 3), 30 / 255.0, dtype=np.float32)
        board = board * (1.0 - 0.45 * shift(blur(a, 12.0), 10, 0))[..., None]
        board = board * (1.0 - a)[..., None] + rgb * a[..., None]
        to_image(board).save(OUT_DIR / "preview-squircle.png", "PNG")
        to_image(board).resize((128, 128), Image.Resampling.LANCZOS).save(
            OUT_DIR / "preview-dock-128.png", "PNG"
        )

    px = master.convert("RGBA")
    corners = [
        px.getpixel((0, 0)),
        px.getpixel((FINAL - 1, 0)),
        px.getpixel((0, FINAL - 1)),
        px.getpixel((FINAL - 1, FINAL - 1)),
    ]
    print("wrote", master_path)
    print("corners", corners)
    print("center", px.getpixel((FINAL // 2, FINAL // 2)))
    print("top-mid", px.getpixel((FINAL // 2, 0)))


if __name__ == "__main__":
    main()
