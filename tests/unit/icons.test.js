import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const app = (p) => new URL(`../../app${p}`, import.meta.url);
const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

test("manifest icons exist at their stated sizes, with a maskable icon", () => {
  const m = JSON.parse(readFileSync(app("/manifest.webmanifest"), "utf8"));
  for (const i of m.icons) {
    assert.ok(existsSync(app(i.src)), i.src);
    if (i.type === "image/png") {
      const [w, h] = pngSize(readFileSync(app(i.src)));
      assert.equal(`${w}x${h}`, i.sizes, i.src);
    }
  }
  for (const s of ["192x192", "512x512"]) {
    assert.ok(m.icons.some((i) => i.sizes === s && i.purpose === "maskable"), `maskable ${s}`);
    assert.ok(m.icons.some((i) => i.sizes === s && i.purpose === "any"), `any ${s}`);
  }
});

test("favicons: svg, a multi-size ico and a 180px apple-touch icon", () => {
  const ico = readFileSync(app("/favicon.ico"));
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256).sort((a, b) => a - b);
  assert.deepEqual(sizes, [16, 32, 48]);
  assert.deepEqual(pngSize(readFileSync(app("/icons/apple-touch-icon.png"))), [180, 180]);
  for (const f of ["/icons/icon.svg", "/icons/favicon.svg", "/icons/icon-maskable.svg", "/img/curebranch-wordmark.svg", "/img/curebranch-wordmark-horizontal.svg"]) {
    const s = readFileSync(app(f), "utf8");
    assert.match(s, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="/, f);
    assert.ok(!/<image|<script|href=/.test(s), `${f} is plain vector paths`);
  }
  for (const page of ["/index.html", "/profile.html", "/how-it-started.html"]) {
    const h = readFileSync(app(page), "utf8");
    assert.ok(h.includes('href="/favicon.ico"') && h.includes('href="/icons/favicon.svg"') && h.includes('href="/icons/apple-touch-icon.png"'), page);
  }
});
