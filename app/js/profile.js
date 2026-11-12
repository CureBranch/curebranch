// Public profile page: <PUBLIC_BASE><code>, e.g. my.curebranch.ai/k7x2m9.
// Anonymous by default; shows a name/photo only if the patient opted in.
import { CONFIG } from "./config.js";
import { loadRecord, saveRecord, ownerPublicJwk, ownerKeys } from "./store.js";
import { BADGES, NOTE_MAX, recognitionOf, earnedBadges, helpedWords, cardLines, shouldGlow, branchTreeSvg } from "./recognition.js";
import { localStubSource } from "./recognition-source.js";
import { extractFacts, suggestBranch } from "./fhir.js";
import { privacyLevel, isPublicLevel, levelName } from "./privacy.js";
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
    // Fresh numbers first, so the preview matches what the public page would show.
    const st = await localStubSource({ summaries: await examples() }).stats(local);
    local.recognition = { ...recognitionOf(local), stats: { helpedCount: st.helpedCount, foundingNumber: st.foundingNumber, nearby: st.nearby, example: st.example, checkedAt: new Date().toISOString() } };
    await saveRecord(local, null);
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

let exampleSummaries = null;
async function examples() {
  if (!exampleSummaries) { try { exampleSummaries = (await (await fetch("/data/example-summaries.json")).json()).summaries; } catch { exampleSummaries = []; } }
  return exampleSummaries;
}
const badgeName = (id) => (BADGES.find((b) => b.id === id) || {}).name || id;
const LEVEL_WORDS = { "detailed": "Detailed public", "full": "Full public", "basic": "Basic public summary" };

/** What a visitor sees: only what the patient switched on. */
function publicRecognitionHtml(s, preview) {
  const r = s.recognition;
  if (!r) return "";
  let h = "";
  const ex = r.example ? " (example numbers)" : "";
  if (Number.isInteger(r.helpedCount)) h += `<p class="rc-big">${esc(helpedWords(r.helpedCount).replace(/^Your branch/, "This branch"))}${esc(ex)}</p>`;
  if (r.badges && r.badges.length) h += `<p>${r.badges.map((b) => `<span class="chip rc-badge">${esc(badgeName(b))}</span>`).join(" ")}</p>`;
  if (r.showBranch) h += `<div class="rc-tree" data-rc-public-tree></div>`;
  if (r.acceptsNotes && !preview) h += `<form class="rc-note-form" id="rc-send" novalidate>
      <label class="field-label" for="rc-note">Send an anonymous "this helped me" note</label>
      <textarea class="field" id="rc-note" maxlength="${NOTE_MAX}" rows="3" aria-describedby="rc-note-help"></textarea>
      <p class="wz-note" id="rc-note-help">Up to ${NOTE_MAX} letters. No names, links, emails or phone numbers. Your name is never sent.</p>
      <button type="submit" class="btn btn-primary">Send thank-you note</button>
      <p class="rc-msg" id="rc-send-msg" role="status" aria-live="polite"></p></form>`;
  return h ? `<div class="card" id="rc-public"><h2>Recognition</h2>${h}</div>` : "";
}

function onOff(id, label, help, on) {
  return `<label class="rc-opt" for="${id}"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><span><strong>${esc(label)}</strong><br><span class="sub">${esc(help)}</span></span></label>`;
}

/** The patient's own controls. Shown only on their own page, on their device. */
async function ownerHtml(record, source) {
  const r = recognitionOf(record);
  const stats = await source.stats(record);
  // Remember the latest numbers so badges and the public page use them.
  record.recognition = { ...r, stats: { helpedCount: stats.helpedCount, foundingNumber: stats.foundingNumber, nearby: stats.nearby, example: stats.example, checkedAt: new Date().toISOString() } };
  await saveRecord(record, null);
  const level = privacyLevel(record);
  const pub = isPublicLevel(level);
  const earned = earnedBadges(record, stats);
  const glow = shouldGlow(stats.nearby);
  const path = record.branchPath && record.branchPath.length ? record.branchPath : (record.sources.length ? suggestBranch(extractFacts(record.sources.map((x) => x.bundle))) : null);
  const svg = branchTreeSvg(await examples(), path, { glow });
  const notes = await source.inbox(record);
  const sent = (r.notesSent || []).length;
  return `<section class="card rc-owner" id="recognition" aria-labelledby="rc-h">
    <h2 id="rc-h" tabindex="-1">Your recognition</h2>
    <p class="notice">Only you see this part, on this device. Everything here is off until you turn it on. Your public page shows only your random code unless you choose more.${stats.example ? " <strong>The numbers are EXAMPLES</strong> worked out on this device, because the shared network isn't open yet." : ""}</p>
    ${pub ? "" : `<p class="notice err">Your sharing level is ${esc(levelName(level))}, so nothing here is public. Your data starts helping others only after you pick a public level in Settings.</p>`}
    <h3>Your branch helped</h3>
    <p class="rc-big" id="rc-helped">${esc(helpedWords(stats.helpedCount))}</p>
    <p class="sub">This counts other patients matched to similar branches using your shared summary.</p>
    <h3>Your branch on the tree</h3>
    <div class="rc-tree">${svg}</div>
    <p class="sub" id="rc-glow-words">${glow ? "Your branch is glowing: someone landed near it in the last day." : "Your branch glows when someone lands near it."}</p>
    <h3>Badges</h3>
    <ul class="rc-badges">${BADGES.map((b) => `<li class="${earned.includes(b.id) ? "rc-earned" : "rc-not"}"><strong>${esc(b.name)}</strong>: ${earned.includes(b.id) ? "earned." : "not yet."} <span class="sub">${esc(b.how)}</span></li>`).join("")}</ul>
    <h3>Show on my public page</h3>
    <fieldset class="rc-opts"><legend class="sr-only">Show on my public page</legend>
      ${onOff("rc-show-helped", "How many people my branch helped", "Shows just the number.", r.showOnProfile.helped)}
      ${onOff("rc-show-branch", "My branch picture on the tree", "Shows the tree with your branch drawn thicker.", r.showOnProfile.branch)}
      ${onOff("rc-show-badges", "My badges", "Shows the badges you have earned.", r.showOnProfile.badges)}
      ${onOff("rc-accept-notes", "Accept anonymous thank-you notes", "Others can send a short note. You never see who sent it, and they never see your name.", r.acceptNotes)}
    </fieldset>
    <p class="rc-msg" id="rc-opt-msg" role="status" aria-live="polite"></p>
    <h3>Share card</h3>
    <p class="sub">A picture you can post or send. It never has your name.</p>
    ${onOff("rc-card-code", "Put my random code on the card", "Off means the card only says CureBranch.", r.shareCardIncludeCode)}
    <img class="rc-card-preview" id="rc-card-img" alt="">
    <button type="button" class="btn btn-primary" id="rc-share">Share my card</button>
    <p class="rc-msg" id="rc-share-msg" role="status" aria-live="polite"></p>
    <h3>Thank-you notes</h3>
    ${r.acceptNotes && pub ? (notes.length ? `<ul class="rc-notes">${notes.map((n) => `<li><p>${esc(n.text)}</p><p class="sub">${esc(new Date(n.at).toLocaleDateString("en-US", { month: "long", day: "numeric" }))}${n.example ? " · example note" : ""}</p></li>`).join("")}</ul>` : `<p>No notes yet.</p>`)
      : `<p class="sub">Turn on "Accept anonymous thank-you notes"${pub ? "" : " and pick a public sharing level"} to get notes.</p>`}
    ${sent ? `<p class="sub">You have written ${sent} ${sent === 1 ? "note" : "notes"} to others. They are saved on this device until the shared network opens.</p>` : ""}
  </section>`;
}

/** Draw the share card as a PNG (1080 x 1080). */
function drawCard(lines) {
  const c = document.createElement("canvas");
  c.width = 1080; c.height = 1080;
  const g = c.getContext("2d");
  g.fillStyle = "#15462b"; g.fillRect(0, 0, 1080, 1080);
  g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 28; g.lineCap = "round";
  g.beginPath(); g.moveTo(540, 1000); g.lineTo(540, 820); g.quadraticCurveTo(540, 760, 420, 700); g.moveTo(540, 820); g.quadraticCurveTo(540, 760, 660, 700); g.stroke();
  g.fillStyle = "#fff"; g.textAlign = "center";
  let y = 230;
  lines.forEach((t, i) => {
    const size = i === 0 ? 76 : i === 1 ? 64 : 40;
    g.font = `${i < 2 ? "700" : "500"} ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
    const words = t.split(" "); let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (g.measureText(test).width > 920 && line) { g.fillText(line, 540, y); y += size * 1.25; line = w; } else line = test;
    }
    g.fillText(line, 540, y); y += size * 1.25 + 24;
  });
  return c;
}

function wireOwner(record, source, s) {
  const box = document.getElementById("recognition");
  const lines = () => { const r = recognitionOf(record); return cardLines({ helpedCount: (r.stats || {}).helpedCount || 0, code: record.code, includeCode: r.shareCardIncludeCode, badges: earnedBadges(record, r.stats || {}) }); };
  const preview = () => { const l = lines(); const img = document.getElementById("rc-card-img"); img.src = drawCard(l).toDataURL("image/png"); img.alt = "Share card preview: " + l.join(" "); };
  preview();
  const map = { "rc-show-helped": ["showOnProfile", "helped"], "rc-show-branch": ["showOnProfile", "branch"], "rc-show-badges": ["showOnProfile", "badges"], "rc-accept-notes": ["acceptNotes"], "rc-card-code": ["shareCardIncludeCode"] };
  box.addEventListener("change", async (e) => {
    const k = map[e.target.id];
    if (!k) return;
    const r = (record.recognition = recognitionOf(record));
    if (k.length === 2) r[k[0]][k[1]] = e.target.checked; else r[k[0]] = e.target.checked;
    await saveRecord(record, `Recognition: ${e.target.checked ? "turned on" : "turned off"} ${e.target.closest("label").querySelector("strong").textContent}`);
    if (e.target.id === "rc-card-code") { preview(); document.getElementById("rc-share-msg").textContent = "Card updated."; return; }
    const msg = document.getElementById("rc-opt-msg");
    msg.textContent = `Saved. ${isPublicLevel(privacyLevel(record)) ? "Your public page is updated." : "This will show only after you pick a public sharing level."}`;
    if (e.target.id === "rc-accept-notes") { const id = e.target.id; await render(); const el = document.getElementById(id); if (el) el.focus(); }
  });
  document.getElementById("rc-share").addEventListener("click", async () => {
    const msg = document.getElementById("rc-share-msg");
    const l = lines();
    const blob = await new Promise((res) => drawCard(l).toBlob(res, "image/png"));
    const file = new File([blob], "curebranch-card.png", { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: l.slice(0, 2).join(" ") });
        msg.textContent = "Shared.";
        return;
      }
    } catch (err) { if (err && err.name === "AbortError") { msg.textContent = "Not shared."; return; } }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "curebranch-card.png";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    msg.textContent = "Your card was downloaded as a picture (curebranch-card.png). You can post or send it.";
  });
}

function wireSend(code) {
  const f = document.getElementById("rc-send");
  if (!f) return;
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("rc-send-msg");
    const me = await loadRecord().catch(() => null);
    if (!me) { msg.innerHTML = `To send a note, set up CureBranch on this device first. <a class="link" href="/?setup=1">Start the easy setup guide</a>`; return; }
    const res = await localStubSource({ summaries: await examples() }).sendNote(me, code, document.getElementById("rc-note").value);
    if (!res.ok) { msg.textContent = res.reason; document.getElementById("rc-note").focus(); return; }
    await saveRecord(me, "Wrote an anonymous thank-you note");
    document.getElementById("rc-note").value = "";
    msg.textContent = "Thank you. Your note is saved on this device and will be delivered when the shared network opens. Your name is never sent.";
  });
}

let render = async () => {};

async function main() {
  const box = document.getElementById("profile");
  const code = codeFromUrl();
  if (!code && !/^\/profile(\.html)?\/?$/.test(location.pathname)) {
    // GitHub Pages serves this file for any unknown address: show a real "Page not found" page.
    document.title = "Page not found | CureBranch";
    box.innerHTML = `<h1 id="p-title">Page not found</h1>
      <p>Sorry, there is no page at <span class="mono">${esc(location.pathname)}</span>. It may have moved.</p>
      <p>Try one of these:</p>
      <ul class="tight"><li><a href="/">Home</a></li><li><a href="/cancers/">All cancer trees</a></li><li><a href="/how-it-works/">How it works</a></li><li><a href="/help/">Help: questions and answers</a></li></ul>`;
    return;
  }
  if (!code) { box.innerHTML = `<h1 id="p-title">No profile code</h1><p>Profile addresses look like ${esc(CONFIG.PUBLIC_BASE)}k7x2m9.</p>`; return; }
  document.title = `Patient ${code} | CureBranch`;
  const found = await findSummary(code);
  if (!found) { box.innerHTML = `<h1 id="p-title">Not found</h1><p>No public summary uses the code <span class="mono">${esc(code)}</span>.</p>`; return; }
  const s = found.summary;
  if (s.visibility !== "public") {
    box.innerHTML = `<h1 id="p-title">This page is private</h1>${found.preview ? `<p class="notice">This is your own code. Pick a public sharing level in the app's Settings to share your summary.</p>` : ""}`;
    if (found.preview) await addOwner(box, s);
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
    <aside class="what-is" aria-labelledby="wi-profile"><h2 class="what-is-h" id="wi-profile">What is this page?</h2><p>This is one patient's public page. They chose to share this short summary of their own records, under a random code instead of their name. It shows their branch on the tree, and what they tried. It is one person's story, not medical advice.</p></aside>
    <p><span class="chip ${s.verification.status === "verified" ? "" : "amber"}">${s.verification.status === "verified" ? "Verified records" : "Unverified: shown, not counted"}</span>
       ${signed ? `<span class="chip sky">Signed by the patient</span>` : ""}</p>
    <div class="card tint"><h2>Branch</h2><p style="margin:0">${esc(s.branch.path.join(" › "))}</p>
      ${s.stageGroup || s.ageBand ? `<p class="sub" style="margin:6px 0 0">${s.stageGroup ? esc(s.stageDetail || "Stage " + s.stageGroup) : ""}${s.stageGroup && s.ageBand ? " · " : ""}${s.ageBand ? "Age " + esc(Number.isInteger(s.age) ? s.age : s.ageBand) : ""}</p>` : ""}</div>
    ${s.markers ? `<div class="card"><h2>Markers</h2><p style="margin:0">${s.markers.map((m) => `<span class="chip">${esc(m.gene)}${m.change ? " " + esc(m.change) : ""}</span>`).join("")}</p></div>` : ""}
    ${s.treatments ? `<div class="card"><h2>Treatments and how it went</h2>${s.treatments.map((t, i) => {
      const nx = (s.outcomes || []).find((o) => typeof o.afterTreatment === "number" && o.afterTreatment >= i);
      const after = nx ? WORDS[nx.status] : "";
      return `<p style="margin:0 0 6px"><strong>${esc(t.name)}</strong>${t.startDate ? ` (from ${esc(t.startDate)}${t.endDate ? ` to ${esc(t.endDate)}` : ""})` : t.startYear ? ` (${t.startYear})` : ""}${after ? `: ${esc(after)}` : ""}${t.dosage ? `<br><span class="sub">${esc(t.dosage)}</span>` : ""}</p>`; }).join("")}</div>` : ""}
    ${s.diagnosisDate || s.location ? `<div class="card"><h2>More details</h2>${s.diagnosisDate ? `<p style="margin:0 0 6px">Diagnosed ${esc(s.diagnosisDate)}</p>` : ""}${s.location ? `<p style="margin:0">Lives in ${esc([s.location.city, s.location.state, s.location.country].filter(Boolean).join(", "))}</p>` : ""}</div>` : ""}
    ${publicRecognitionHtml(s, found.preview)}
    ${s.publicContact ? `<p>Public contact: <span class="mono">${esc(s.publicContact)}</span></p>` : ""}
    <p class="sub">${s.detailLevel ? `Shared at: ${esc(LEVEL_WORDS[s.detailLevel])}. ` : ""}Last updated ${esc(s.updated)}.</p>`;
  const pt = box.querySelector("[data-rc-public-tree]");
  if (pt) pt.innerHTML = branchTreeSvg(await examples(), s.branch.path);
  wireSend(code);
  if (found.preview) await addOwner(box, s);
}

async function addOwner(box, s) {
  const record = await loadRecord();
  const source = localStubSource({ summaries: await examples() });
  box.insertAdjacentHTML("beforeend", await ownerHtml(record, source));
  wireOwner(record, source, s);
  if (location.hash === "#recognition") document.getElementById("rc-h").focus();
}
render = main;
main();
