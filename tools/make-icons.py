"""Renders the logo SVGs in app/icons/ to PNG and ICO with headless Chromium (Playwright).
Run: python3 tools/make-icons.py

Sources (hand-checked vector art):
  icon.svg          full app icon (rounded square), used for 192/512 PNGs and the manifest "any" icon
  icon-maskable.svg full-bleed square with the tree inside the maskable safe zone
  icon-apple.svg    full-bleed square for iOS (iOS rounds the corners itself)
  favicon.svg       simplified tree for 16-48px (thicker strokes so it stays crisp in a browser tab)
"""
import io
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parent.parent / "app"
ICONS = ROOT / "icons"
jobs = [("icon.svg", 192, "icon-192.png"), ("icon.svg", 512, "icon-512.png"),
        ("icon-maskable.svg", 192, "icon-maskable-192.png"), ("icon-maskable.svg", 512, "icon-maskable-512.png"),
        ("icon-apple.svg", 180, "apple-touch-icon.png"),
        ("favicon.svg", 16, "favicon-16.png"), ("favicon.svg", 32, "favicon-32.png"), ("favicon.svg", 48, "favicon-48.png")]
with sync_playwright() as p:
    b = p.chromium.launch()
    for src, size, out in jobs:
        pg = b.new_page(viewport={"width": size, "height": size})
        svg = (ICONS / src).read_text()
        pg.set_content(f'<html><body style="margin:0;background:transparent">{svg.replace("<svg ", f"<svg width=\'{size}\' height=\'{size}\' style=\'display:block\' ", 1)}</body></html>')
        pg.screenshot(path=str(ICONS / out), omit_background=True, clip={"x": 0, "y": 0, "width": size, "height": size})
        pg.close()
    b.close()
# favicon.ico with separately rendered 16, 32 and 48px images (not one image scaled down)
imgs = [Image.open(ICONS / f"favicon-{n}.png").convert("RGBA") for n in (48, 32, 16)]
imgs[0].save(ROOT / "favicon.ico", format="ICO", sizes=[(48, 48), (32, 32), (16, 16)], append_images=imgs[1:])
print("icons written")
