"""Renders app/icons/*.svg to PNG with headless Chromium (Playwright). Run: python3 tools/make-icons.py"""
from pathlib import Path
from playwright.sync_api import sync_playwright
ICONS = Path(__file__).resolve().parent.parent / "app" / "icons"
jobs = [("icon.svg", 192, "icon-192.png"), ("icon.svg", 512, "icon-512.png"),
        ("icon-maskable.svg", 512, "icon-maskable-512.png"), ("icon.svg", 180, "apple-touch-icon.png")]
with sync_playwright() as p:
    b = p.chromium.launch()
    for src, size, out in jobs:
        pg = b.new_page(viewport={"width": size, "height": size})
        svg = (ICONS / src).read_text()
        pg.set_content(f'<html><body style="margin:0;background:transparent">{svg.replace("<svg ", f"<svg width=\'{size}\' height=\'{size}\' ", 1)}</body></html>')
        pg.screenshot(path=str(ICONS / out), omit_background=True, clip={"x": 0, "y": 0, "width": size, "height": size})
        pg.close()
    b.close()
print("icons written")
