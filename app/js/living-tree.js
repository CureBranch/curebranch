// A lifelike picture of the knowledge tree, drawn as plain SVG (no library, no network).
// Input is the node tree from buildTree() in tree.js. Output is an SVG string, so this
// module has no DOM and is unit-tested in Node.
//
// How it is drawn (classic recursive branching, like the "fractal tree" / L-system idea):
//  * a tapering trunk with bark shading and bark lines, roots spreading over the ground;
//  * one limb per cancer type, forking into genes, then changes (the patient branches);
//    limb thickness follows how many summaries sit on it (pipe model: area ~ count);
//  * branches bend outward first and then turn up toward the light;
//  * small side twigs are grown recursively to fill the crown;
//  * leaf clusters in several greens, lit from the top left, with a darker back layer;
//  * a gentle sway (CSS, only when the person allows motion).
// Everything random comes from a seeded generator, keyed on the branch names, so the
// same data always draws the same tree.
//
// Seeded random numbers: mulberry32 by Tommy Ettinger (public domain).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** FNV-1a string hash, used to seed the generator per branch. */
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f1 = (n) => (Math.round(n * 10) / 10).toString();
const RAD = Math.PI / 180;
const dirOf = (deg) => ({ x: Math.sin(deg * RAD), y: -Math.cos(deg * RAD) });

const W = 600, H = 560, GROUND = 500, BASE_X = 300;
const LEAF_DARK = ["#1d4a2a", "#234f2c", "#1f4426", "#2a5a31"];
const LEAF_MID = ["#2f6b36", "#3a7a3a", "#447f3c", "#356f33", "#4c873d", "#3f7a42"];
const LEAF_LIGHT = ["#5f9e47", "#6fae50", "#7db857", "#8cc263", "#9acb6a", "#a7c957"];
const MAX_LIMBS = 6;

/** Encode a branch path for a data attribute. */
export function pathKey(path) { return path.map(encodeURIComponent).join("/"); }
export function parsePathKey(key) { return String(key || "").split("/").filter(Boolean).map(decodeURIComponent); }

function qpt(p0, c, p1, t) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
}
function qtan(p0, c, p1, t) {
  const x = 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x), y = 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y);
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

/**
 * Build the tree picture.
 * opts: { mine: string[]|null, selected: string[]|null, glow: bool, interactive: bool,
 *         label: string (img label when not interactive), idPrefix: string, labels: bool }
 */
export function livingTreeSvg(root, opts = {}) {
  const { mine = null, selected = null, glow = false, interactive = false, label = "Tree picture.", labels = true } = opts;
  const P = (opts.idPrefix || "lt") + "-";
  // Pick the limbs to draw (largest first), keep the patient's own branch even if small.
  let tops = [...root.children.values()].sort((a, b) => b.shown - a.shown || a.name.localeCompare(b.name)).slice(0, MAX_LIMBS);
  if (mine && mine.length) {
    let top = root.children.get(mine[0]);
    if (!top) { top = { name: mine[0], shown: 0, counted: 0, children: new Map(), summaries: [] }; }
    let n = top;
    for (const part of mine.slice(1)) {
      if (!n.children.has(part)) n.children.set(part, { name: part, shown: 0, counted: 0, children: new Map(), summaries: [] });
      n = n.children.get(part);
    }
    if (!tops.includes(top)) { tops = tops.slice(0, MAX_LIMBS - 1); tops.push(top); }
  }
  // Biggest limbs in the middle, smaller ones toward the sides, alternating left/right.
  const order = [];
  tops.forEach((t, i) => { if (i % 2) order.push(t); else order.unshift(t); });
  const total = Math.max(1, tops.reduce((s, t) => s + Math.max(1, t.shown), 0));
  const rng = mulberry32(hashStr(tops.map((t) => t.name).join("|") || "curebranch"));
  const rr = (a, b) => a + (b - a) * rng();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const isOnPath = (p, path) => !!path && p.length <= path.length && p.every((x, i) => x === path[i]);

  const branches = [];   // {p0,c,p1,w0,w1,mine,limb,bark}
  const backLeaves = []; // clusters behind the branches
  const frontLeaves = [];
  const hits = [];
  const limbOrigins = [];

  function addBranch(p0, ang, L, w0, w1, extra = {}) {
    const d0 = dirOf(ang), dc = dirOf(ang + (extra.bend ?? 0));
    const c = { x: p0.x + dc.x * L * 0.55, y: p0.y + dc.y * L * 0.55 };
    const p1 = { x: p0.x + d0.x * L, y: p0.y + d0.y * L };
    const b = { p0, c, p1, w0, w1, ...extra };
    branches.push(b);
    return b;
  }
  function cluster(x, y, R, front, limb, tone = 0) {
    (front ? frontLeaves : backLeaves).push({ x, y, R, limb, tone, seed: Math.floor(rng() * 1e9) });
  }
  function twig(p0, ang, L, w, depth, limb, front) {
    const b = addBranch(p0, ang, L, w, Math.max(0.8, w * 0.55), { bend: rr(-14, 14), limb });
    if (depth <= 0 || L < 18) {
      cluster(b.p1.x, b.p1.y, rr(16, 26) * (L / 40 + 0.5), front, limb, front ? 0 : -1);
      return;
    }
    const k = rng() < 0.7 ? 2 : 3;
    for (let i = 0; i < k; i++) {
      const a = ang + (i - (k - 1) / 2) * rr(24, 38) + rr(-8, 8);
      twig(b.p1, a * 0.9, L * rr(0.6, 0.75), b.w1, depth - 1, limb, front);
    }
  }

  // Trunk.
  const trunkTop = { x: BASE_X + rr(-8, 8), y: 345 };
  const trunkW0 = 62, trunkW1 = 36;
  const trunk = { p0: { x: BASE_X, y: GROUND - 2 }, c: { x: BASE_X + rr(-14, 14), y: (GROUND + trunkTop.y) / 2 }, p1: trunkTop, w0: trunkW0, w1: trunkW1, bark: true, limb: -1 };

  // Roots: spread sideways over the ground, tapering to nothing.
  const roots = [];
  const nRoots = 7;
  for (let i = 0; i < nRoots; i++) {
    const side = i % 2 ? 1 : -1;
    const spread = 0.35 + (Math.floor(i / 2) / Math.ceil(nRoots / 2)) * 0.65;
    const ang = side * (70 + spread * 30 + rr(-6, 6)) + 180 * 0; // mostly sideways, a bit down
    const L = rr(46, 92) * (1.15 - spread * 0.3);
    const p0 = { x: BASE_X + side * rr(4, 16), y: GROUND - rr(10, 22) };
    const d = dirOf(ang), dc = dirOf(ang - side * 22);
    roots.push({ p0, c: { x: p0.x + dc.x * L * 0.45, y: p0.y + dc.y * L * 0.45 + 12 }, p1: { x: p0.x + d.x * L, y: GROUND + rr(4, 14) }, w0: rr(16, 24), w1: 1, bark: true, limb: -1 });
  }

  // Limbs, genes, changes.
  const nL = order.length || 1;
  const spreadDeg = nL === 1 ? 0 : Math.min(128, 40 + nL * 18);
  function grow(node, path, p0, ang, L, w0, depth, limb) {
    const kids = [...node.children.values()].sort((a, b) => b.shown - a.shown || a.name.localeCompare(b.name));
    const w1 = Math.max(2.2, w0 * (kids.length ? 0.74 : 0.5));
    const onMine = isOnPath(path, mine);
    const b = addBranch(p0, ang, L, w0, w1, { bend: (ang > 0 ? 1 : -1) * Math.min(28, Math.abs(ang) * 0.4 + 12) * (depth === 1 ? 1 : 0.6), limb, mine: onMine, bark: depth === 1 });
    // Side twigs to fill the crown.
    const nTw = depth === 1 ? 2 : 1;
    for (let i = 0; i < nTw; i++) {
      const t = rr(0.45, 0.8);
      const at = qpt(b.p0, b.c, b.p1, t);
      const side = (i + (depth % 2)) % 2 ? 1 : -1;
      twig(at, ang * 0.7 + side * rr(30, 55), L * rr(0.35, 0.5), Math.max(1.5, (w0 + (w1 - w0) * t) * 0.45), depth === 1 ? 2 : 1, limb, rng() < 0.4);
    }
    if (!kids.length) {
      const R = 24 + 7 * Math.sqrt(Math.max(1, node.shown));
      cluster(b.p1.x, b.p1.y, R * 1.15, false, limb, -1);
      cluster(b.p1.x, b.p1.y, R, true, limb, 1);
      hits.push({ x: b.p1.x, y: b.p1.y, path, node, limb, tip: true, R });
      return;
    }
    if (depth === 1) hits.push({ x: b.p1.x, y: b.p1.y, path, node, limb, tip: false, R: 0 });
    const k = kids.length;
    const sp = k === 1 ? 0 : Math.min(84, 30 + 18 * (k - 1));
    kids.forEach((kid, i) => {
      const share = Math.sqrt(Math.max(1, kid.shown) / Math.max(1, node.shown));
      const a = ang * 0.82 + (k === 1 ? rr(-10, 10) : -sp / 2 + (sp * i) / (k - 1)) + rr(-5, 5);
      grow(kid, [...path, kid.name], b.p1, a, L * rr(0.58, 0.7), Math.max(2.4, w1 * Math.max(0.55, share)), depth + 1, limb);
    });
  }
  order.forEach((t, i) => {
    const frac = nL === 1 ? 0.5 : i / (nL - 1);
    let ang = -spreadDeg / 2 + spreadDeg * frac + rr(-4, 4);
    if (Math.abs(ang) < 12) ang = (ang < 0 || (ang === 0 && rng() < 0.5) ? -1 : 1) * rr(12, 18); // no straight poles: the middle limb leans
    const tt = 0.72 + 0.28 * (1 - Math.abs(ang) / 80) + rr(-0.03, 0.03);
    const p0 = qpt(trunk.p0, trunk.c, trunk.p1, Math.min(1, tt));
    const share = Math.sqrt(Math.max(1, t.shown) / total);
    const L = 108 + 40 * share + rr(-6, 6);
    limbOrigins[i] = p0;
    grow(t, [t.name], p0, ang * 1.05, L, Math.max(7, trunkW1 * 0.95 * Math.max(0.42, share)), 1, i);
  });
  // A leader at the top of the trunk and low twigs, so the crown is full even with few limbs.
  twig(trunkTop, rr(-6, 6), 92, 9, 3, -1, false);
  twig(qpt(trunk.p0, trunk.c, trunk.p1, 0.6), -58, 60, 6, 1, -1, false);
  twig(qpt(trunk.p0, trunk.c, trunk.p1, 0.66), 56, 58, 6, 1, -1, false);

  // Fit inside the picture: scale around the trunk base so nothing is cut off.
  let minX = BASE_X, maxX = BASE_X, minY = GROUND;
  const grow2 = (x, y, r) => { minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r); minY = Math.min(minY, y - r); };
  for (const b of branches) { grow2(b.p1.x, b.p1.y, b.w1); grow2(b.c.x, b.c.y, 0); }
  for (const c of [...backLeaves, ...frontLeaves]) grow2(c.x, c.y, c.R * 1.08);
  const margin = 14;
  const s = Math.min(1, (W / 2 - margin) / Math.max(1, BASE_X - minX, maxX - BASE_X), (GROUND - margin - (labels ? 8 : 0)) / Math.max(1, GROUND - minY));
  const T = (p) => ({ x: BASE_X + (p.x - BASE_X) * s, y: GROUND + (p.y - GROUND) * s });
  const fitB = (b) => ({ ...b, p0: T(b.p0), c: T(b.c), p1: T(b.p1), w0: b.w0 * s, w1: b.w1 * s });
  const allB = branches.map(fitB), fTrunk = fitB(trunk), fRoots = roots.map(fitB);
  const fitC = (c) => ({ ...c, ...T(c), R: c.R * s });
  const fBack = backLeaves.map(fitC), fFront = frontLeaves.map(fitC);
  const fHits = hits.map((h) => ({ ...h, ...T(h), R: h.R * s }));
  const fOrig = limbOrigins.map(T);

  // ---- drawing helpers ----
  function taper(b, wScale = 1, off = 0, n = 12) {
    const L = [], R = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = qpt(b.p0, b.c, b.p1, t), tg = qtan(b.p0, b.c, b.p1, t);
      const nx = -tg.y, ny = tg.x;
      const w = (b.w0 + (b.w1 - b.w0) * Math.pow(t, 0.9)) * wScale / 2;
      const o = off * (b.w0 + (b.w1 - b.w0) * t);
      L.push(`${f1(p.x + nx * (w + o))} ${f1(p.y + ny * (w + o))}`);
      R.push(`${f1(p.x - nx * (w - o))} ${f1(p.y - ny * (w - o))}`);
    }
    return `M${L.join("L")}L${R.reverse().join("L")}Z`;
  }
  function lightSide(b) { const tg = qtan(b.p0, b.c, b.p1, 0.5); return -tg.y > 0 ? -1 : 1; } // normal points right -> light is the other side
  function barkLines(b, count, rnd) {
    let out = "";
    for (let k = 0; k < count; k++) {
      const v = -0.36 + (0.72 * (k + rnd())) / count;
      const t0 = rnd() * 0.25, t1 = 0.6 + rnd() * 0.4;
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const t = t0 + ((t1 - t0) * i) / 8;
        const p = qpt(b.p0, b.c, b.p1, t), tg = qtan(b.p0, b.c, b.p1, t);
        const w = b.w0 + (b.w1 - b.w0) * t;
        const o = v * w + (rnd() - 0.5) * 1.6;
        pts.push(`${f1(p.x - tg.y * o)} ${f1(p.y + tg.x * o)}`);
      }
      out += `<path d="M${pts.join("L")}" stroke-width="${f1(0.8 + rnd() * 1.4)}"/>`;
    }
    return out;
  }
  function drawBranch(b, rnd) {
    const ls = lightSide(b);
    let g = "";
    if (b.mine) g += `<path class="lt-mine-glow" d="${taper(b, 1, 0)}" stroke-width="${f1(Math.max(5, b.w0 * 0.35))}"/>`;
    g += `<path d="${taper(b)}" fill="url(#${P}bark)"/>`;
    if (b.w0 > 3.5) {
      g += `<path d="${taper(b, 0.32, ls * 0.2)}" fill="#a1805f" fill-opacity=".55"/>`;
      g += `<path d="${taper(b, 0.3, -ls * 0.28)}" fill="#24170f" fill-opacity=".45"/>`;
    }
    if (b.bark && b.w0 > 9) g += `<g class="lt-barklines" fill="none" stroke="#2a1b12" stroke-opacity=".5" stroke-linecap="round">${barkLines(b, Math.round(b.w0 / 5), rnd)}</g>`;
    return g;
  }
  function drawCluster(c, layer) {
    const rnd = mulberry32(c.seed);
    const blobs = Math.round(6 + c.R / 6);
    let shadow = "", body = "", light = "", leaves = "";
    for (let i = 0; i < blobs; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * c.R * 0.55;
      const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d * 0.8;
      const r = c.R * (0.32 + rnd() * 0.26);
      if (c.tone < 0) { body += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${LEAF_DARK[Math.floor(rnd() * LEAF_DARK.length)]}"/>`; continue; }
      shadow += `<circle cx="${f1(x + r * 0.18)}" cy="${f1(y + r * 0.24)}" r="${f1(r)}" fill="${LEAF_DARK[Math.floor(rnd() * LEAF_DARK.length)]}"/>`;
      body += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r * 0.92)}" fill="${LEAF_MID[Math.floor(rnd() * LEAF_MID.length)]}"/>`;
      if (y < c.y + c.R * 0.2 && x < c.x + c.R * 0.3) light += `<circle cx="${f1(x - r * 0.22)}" cy="${f1(y - r * 0.28)}" r="${f1(r * 0.55)}" fill="${LEAF_LIGHT[Math.floor(rnd() * LEAF_LIGHT.length)]}" fill-opacity=".9"/>`;
    }
    // Single leaves around the edge so the outline looks leafy, not like balls.
    const nLeaves = Math.round(c.R / (c.tone < 0 ? 4 : 2.6));
    for (let i = 0; i < nLeaves; i++) {
      const a = rnd() * Math.PI * 2, d = c.R * (0.55 + rnd() * 0.42);
      const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d * 0.85;
      const top = Math.sin(a) < -0.2 && Math.cos(a) < 0.5;
      const col = c.tone < 0 ? LEAF_DARK[Math.floor(rnd() * LEAF_DARK.length)] : top ? LEAF_LIGHT[Math.floor(rnd() * LEAF_LIGHT.length)] : LEAF_MID[Math.floor(rnd() * LEAF_MID.length)];
      leaves += `<use href="#${P}leaf" transform="translate(${f1(x)} ${f1(y)}) rotate(${Math.round(a / RAD + rnd() * 70 - 35)}) scale(${f1(0.7 + rnd() * 0.6)})" fill="${col}"/>`;
    }
    return shadow + body + light + leaves;
  }

  // ---- assemble ----
  const groupsBack = new Map(), groupsBranch = new Map(), groupsFront = new Map(), groupsHit = new Map();
  const add = (m, k, s2) => m.set(k, (m.get(k) || "") + s2);
  const brnd = mulberry32(hashStr("bark") ^ hashStr(String(order.length)));
  for (const c of fBack) add(groupsBack, c.limb, drawCluster(c, "back"));
  for (const b of allB) add(groupsBranch, b.limb, drawBranch(b, brnd));
  for (const c of fFront) add(groupsFront, c.limb, drawCluster(c, "front"));

  const swayAttr = (limb) => {
    if (limb < 0) return ` class="lt-sway lt-sway-crown" style="transform-origin:${f1(fTrunk.p1.x)}px ${f1(fTrunk.p1.y)}px"`;
    const o = fOrig[limb] || fTrunk.p1;
    return ` class="lt-sway" style="transform-origin:${f1(o.x)}px ${f1(o.y)}px;animation-delay:${f1(-limb * 1.7)}s;animation-duration:${f1(6 + (limb % 3) * 1.3)}s"`;
  };
  const limbsSeen = [...new Set([-1, ...order.map((_, i) => i)])];
  const layer = (m) => limbsSeen.filter((k) => m.has(k)).map((k) => `<g${swayAttr(k)}>${m.get(k)}</g>`).join("");

  // Interactive parts: one button per patient branch (tips) and per cancer type (limb fork).
  const labelsSvg = [];
  for (const h of fHits) {
    const isMine = !!mine && isOnPath(h.path, mine) && (h.tip ? h.path.length === mine.length : true);
    const isSel = !!selected && selected.length === h.path.length && isOnPath(h.path, selected);
    const words = `${h.path.join(", then ")}. ${h.node.shown} shown, ${h.node.counted} counted.${isMine && h.tip ? " This is your branch." : ""}`;
    const r = h.tip ? Math.max(30, h.R * 0.75) : 26;
    let inner = "";
    if (h.tip && isMine) {
      const pr = 9;
      let petals = "";
      for (let i = 0; i < 5; i++) { const a = (i * 72 - 90) * RAD; petals += `<circle cx="${f1(h.x + Math.cos(a) * pr)}" cy="${f1(h.y + Math.sin(a) * pr)}" r="7.5"/>`; }
      inner += `<g class="lt-blossom${glow ? " tr-glow" : ""}" aria-hidden="true">${petals}<circle class="lt-blossom-c" cx="${f1(h.x)}" cy="${f1(h.y)}" r="5.5"/></g>`;
    }
    inner += `<circle class="lt-ring" cx="${f1(h.x)}" cy="${f1(h.y)}" r="${f1(r - 3)}"/><circle class="lt-ring-in" cx="${f1(h.x)}" cy="${f1(h.y)}" r="${f1(r - 3)}"/>`;
    inner += `<circle class="lt-hit-area" cx="${f1(h.x)}" cy="${f1(h.y)}" r="${f1(r)}"/>`;
    const cls = `lt-hit${h.tip ? " lt-tip" : " lt-limb"}${isMine ? " lt-is-mine" : ""}${isSel ? " lt-selected" : ""}`;
    const attrs = interactive
      ? ` role="button" tabindex="0" aria-pressed="${isSel}" aria-label="${esc(words)}" data-lt-path="${esc(pathKey(h.path))}"`
      : ` aria-hidden="true"`;
    if (interactive || (h.tip && isMine)) add(groupsHit, h.limb, `<g class="${cls}"${attrs}>${inner}</g>`);
    if (labels && !h.tip) labelsSvg.push(`<text class="lt-label" x="${f1(h.x)}" y="${f1(h.y + 30)}" text-anchor="middle" aria-hidden="true">${esc(h.node.name.slice(0, 14))}</text>`);
    if (labels && h.tip && h.path.length === 1) labelsSvg.push(`<text class="lt-label" x="${f1(h.x)}" y="${f1(h.y + h.R + 18)}" text-anchor="middle" aria-hidden="true">${esc(h.node.name.slice(0, 14))}</text>`);
    if (labels && h.tip && (isMine || isSel) && h.path.length > 1) {
      const y = Math.max(22, h.y - Math.max(30, h.R * 0.75) - 8);
      const txt = (isMine ? "Your branch: " : "") + h.path.slice(1).join(" ").slice(0, 22);
      const half = txt.length * 6.4 + 6; // about half the text width at 21px bold
      labelsSvg.push(`<text class="lt-label lt-label-mine" x="${f1(Math.min(W - half, Math.max(half, h.x)))}" y="${f1(y)}" text-anchor="middle" aria-hidden="true">${esc(txt)}</text>`);
    }
  }

  const defs = `<defs>
<linearGradient id="${P}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d6ebf3"/><stop offset=".7" stop-color="#eef6ef"/><stop offset="1" stop-color="#f3f7ea"/></linearGradient>
<radialGradient id="${P}sun" cx=".18" cy=".1" r=".55"><stop offset="0" stop-color="#fffbe6" stop-opacity=".95"/><stop offset="1" stop-color="#fffbe6" stop-opacity="0"/></radialGradient>
<linearGradient id="${P}bark" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3b2a1f"/><stop offset=".35" stop-color="#6e5039"/><stop offset=".6" stop-color="#5a3f2d"/><stop offset="1" stop-color="#2e2017"/></linearGradient>
<linearGradient id="${P}grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7aa653"/><stop offset="1" stop-color="#4f7d38"/></linearGradient>
<radialGradient id="${P}shade" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#1f3317" stop-opacity=".55"/><stop offset="1" stop-color="#1f3317" stop-opacity="0"/></radialGradient>
<path id="${P}leaf" d="M0 0C3-4.5 9-5.5 14 0C9 5.5 3 4.5 0 0Z"/>
</defs>`;
  const scene = `<rect width="${W}" height="${H}" rx="18" fill="url(#${P}sky)"/><rect width="${W}" height="${H}" rx="18" fill="url(#${P}sun)"/>
<path d="M0 ${GROUND - 4}Q${BASE_X} ${GROUND - 34} ${W} ${GROUND - 4}V${H - 18}Q${W} ${H} ${W - 18} ${H}H18Q0 ${H} 0 ${H - 18}Z" fill="url(#${P}grass)"/>
<ellipse cx="${BASE_X}" cy="${GROUND + 6}" rx="150" ry="16" fill="url(#${P}shade)"/>`;
  let grassTufts = "";
  const grnd = mulberry32(7);
  for (let i = 0; i < 26; i++) {
    const x = 20 + grnd() * (W - 40), y = GROUND + 4 + grnd() * 30, h = 5 + grnd() * 7;
    grassTufts += `<path d="M${f1(x)} ${f1(y)}l${f1(-2 - grnd() * 2)} ${f1(-h)}M${f1(x)} ${f1(y)}l${f1(grnd() * 1.5)} ${f1(-h * 1.2)}M${f1(x)} ${f1(y)}l${f1(2 + grnd() * 2)} ${f1(-h * 0.9)}"/>`;
  }
  const ground = `<g fill="none" stroke="#3f6b2c" stroke-width="1.3" stroke-linecap="round">${grassTufts}</g>`;
  const rootsSvg = fRoots.map((b) => drawBranch(b, brnd)).join("");
  const trunkSvg = drawBranch(fTrunk, brnd);

  const decorative = `<g aria-hidden="true">${scene}${ground}${layer(groupsBack)}${rootsSvg}${trunkSvg}${layer(groupsBranch)}${layer(groupsFront)}${labelsSvg.join("")}</g>`;
  const hitsSvg = layer(groupsHit);
  const head = interactive
    ? `<svg class="lt-svg tr-svg lt-interactive" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(label)}">`
    : `<svg class="lt-svg tr-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
  return `${head}${defs}${decorative}${hitsSvg}</svg>`;
}
