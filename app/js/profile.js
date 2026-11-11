// Public profile page: <PUBLIC_BASE><code>, e.g. my.curebranch.ai/k7x2m9.
// Anonymous by default; shows a name/photo only if the patient opted in.
import { CONFIG } from "./config.js";
import { loadRecord, ownerPublicJwk, ownerKeys } from "./store.js";
import { buildSummary, signSummary, verifySummarySignature } from "./summary.js";
import { sha256Hex } from "./codes.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WORDS = { "no-evidence-of-disease": "no sign of cancer", improving: "improving", stable: "stable", worsening: "worse", "not-determined": "unclear" };

function codeFromUrl() {
  const q = new URLSearchParams(location.search).get("c");
  if (q) return q.toLowerCase();
  const m = location.pathname.match(/^\/(?:p\/)?([0-9a-hjkmnp-tv-z]{6,12})\/?$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Abstract avatar drawn from the code: a small branching mark, no faces, no stock photos. */
async function avatarSvg(code) {
  const h = await sha256Hex(code);
  const hue = parseInt(h.slice(0, 2), 16) * 360 / 256;
  const n = 2 + (parseInt(h[2], 16) % 3);
  let paths = "";
  for (let i = 0; i < n; i++) {
    const x = 20 + (parseInt(h.slice(4 + i * 2, 6 + i * 2), 16) % 60);
    paths += `<path d="M50 88 V58 Q50 46 ${x} ${18 + i * 6}" />`;
  }
  return `<svg viewBox="0 0 100 100" width="96" height="96" aria-hidden="true" style="border-radius:24px;flex:0 0 auto">
    <rect width="100" height="100" fill="hsl(${hue} 35% 30%)"/>
    <g fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round">${paths}</g></svg>`;
}

async function findSummary(code) {
  const local = await loadRecord().catch(() => null);
  if (local && local.code === code) {
    const s = await signSummary(buildSummary(local, await ownerPublicJwk()), (await ownerKeys()).privateKey);
    return { summary: s, preview: true };
  }
  if (CONFIG.PUBLIC_INDEX_URL) {
    try { const r = await fetch(`${CONFIG.PUBLIC_INDEX_URL.replace(/\/$/, "")}/${code}.json`); if (r.ok) return { summary: await r.json() }; } catch { /* offline */ }
  }
  try {
    const ex = await (await fetch("/data/example-summaries.json")).json();
    const s = ex.summaries.find((x) => x.code === code);
    if (s) return { summary: s };
  } catch { /* ignore */ }
  return null;
}

async function main() {
  const box = document.getElementById("profile");
  const code = codeFromUrl();
  if (!code) { box.innerHTML = `<h1 id="p-title">No profile code</h1><p>Profile addresses look like ${esc(CONFIG.PUBLIC_BASE)}k7x2m9.</p>`; return; }
  document.title = `CureBranch: ${code}`;
  const found = await findSummary(code);
  if (!found) { box.innerHTML = `<h1 id="p-title">Not found</h1><p>No public summary uses the code <span class="mono">${esc(code)}</span>.</p>`; return; }
  const s = found.summary;
  if (s.visibility !== "public") {
    box.innerHTML = `<h1 id="p-title">This page is private</h1>${found.preview ? `<p class="notice">This is your own code. Turn on the public switch in the app to share your summary.</p>` : ""}`;
    return;
  }
  const signed = await verifySummarySignature(s).catch(() => false);
  const p = s.profile || {};
  const pic = p.photo ? `<img src="data:${esc(p.photo.mediaType)};base64,${p.photo.data}" alt="${esc(p.photo.alt || "Profile photo")}" width="96" height="96" style="border-radius:24px;object-fit:cover;flex:0 0 auto">` : await avatarSvg(code);
  box.innerHTML = `
    ${found.preview ? `<p class="notice">Preview of your page as others would see it. Nothing has been sent anywhere.</p>` : ""}
    ${s.example ? `<p class="notice"><strong>EXAMPLE DATA.</strong> A made-up patient.</p>` : ""}
    <div class="row" style="margin-bottom:10px">${pic}<div class="grow">
      <h1 id="p-title">${esc(p.displayName || "Anonymous patient")}</h1>
      <p class="sub mono" style="margin:0">${esc(CONFIG.PUBLIC_BASE.replace(/^https:\/\//, ""))}${esc(code)}</p></div></div>
    <p><span class="chip ${s.verification.status === "verified" ? "" : "amber"}">${s.verification.status === "verified" ? "Verified records" : "Unverified: shown, not counted"}</span>
       ${signed ? `<span class="chip sky">Signed by the patient</span>` : ""}</p>
    <div class="card tint"><h2>Branch</h2><p style="margin:0">${esc(s.branch.path.join(" › "))}</p>
      ${s.stageGroup || s.ageBand ? `<p class="sub" style="margin:6px 0 0">${s.stageGroup ? "Stage " + esc(s.stageGroup) : ""}${s.stageGroup && s.ageBand ? " · " : ""}${s.ageBand ? "Age " + esc(s.ageBand) : ""}</p>` : ""}</div>
    ${s.markers ? `<div class="card"><h2>Markers</h2><p style="margin:0">${s.markers.map((m) => `<span class="chip">${esc(m.gene)}${m.change ? " " + esc(m.change) : ""}</span>`).join("")}</p></div>` : ""}
    ${s.treatments ? `<div class="card"><h2>Treatments and how it went</h2>${s.treatments.map((t, i) => {
      const nx = (s.outcomes || []).find((o) => typeof o.afterTreatment === "number" && o.afterTreatment >= i);
      const after = nx ? WORDS[nx.status] : "";
      return `<p style="margin:0 0 6px"><strong>${esc(t.name)}</strong>${t.startYear ? ` (${t.startYear})` : ""}${after ? `: ${esc(after)}` : ""}</p>`; }).join("")}</div>` : ""}
    ${s.publicContact ? `<p>Public contact: <span class="mono">${esc(s.publicContact)}</span></p>` : ""}
    <p class="sub">Last updated ${esc(s.updated)}.</p>`;
}
main();
