// Published, aggregate cancer data (app/data/public-cancer-data.json, made by
// tools/fetch-public-data.mjs). Renders the cancer-tree navigation, the cancer pages and
// the "what published research says" panels. No patient data here: patient-shared
// branches start at zero and are counted separately from published figures.
import { icon } from "./octicons.js";
import { helpTip, helpHeading, whatIsBox } from "./help.js";
import { SITE, subPages, cancerPath } from "./routes.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = (v) => (typeof v === "number" ? v.toLocaleString("en-US") : "");
const date = (yyyymmdd) => (/^\d{8}$/.test(String(yyyymmdd)) ? `${String(yyyymmdd).slice(0, 4)}-${String(yyyymmdd).slice(4, 6)}-${String(yyyymmdd).slice(6, 8)}` : String(yyyymmdd || ""));

let DATA = null;
export async function loadPublicData() {
  if (DATA) return DATA;
  try { DATA = await (await fetch("/data/public-cancer-data.json")).json(); } catch { DATA = { cancers: [], groups: [], sources: {} }; }
  return DATA;
}
export function publicData() { return DATA || { cancers: [], groups: [], sources: {} }; }
export function cancerById(id) { return publicData().cancers.find((c) => c.id === id) || null; }
export function cancerByLabel(label) {
  const l = String(label || "").toLowerCase();
  return publicData().cancers.find((c) => c.treeLabel.toLowerCase() === l || c.name.toLowerCase() === l) || null;
}
/** Genes listed for a cancer, most often mutated first (first study wins on ties). */
export function topGenes(c, k = 6) {
  const seen = new Map();
  for (const g of c.genomics || []) for (const x of g.genes) if (!seen.has(x.gene)) seen.set(x.gene, { ...x, subtype: g.subtype });
  return [...seen.values()].sort((a, b) => b.pct - a.pct).slice(0, k);
}
const geneId = (c, gene) => `g-${c.id}-${gene.replace(/[^A-Za-z0-9]/g, "")}`;

function srcLine(fig) {
  const s = publicData().sources[fig.source] || { name: fig.source, license: "" };
  return `<span class="src">Source: <a href="${esc(fig.url)}" rel="noopener" target="_blank">${esc(s.name.split(",")[0])}</a> · ${esc(s.license.split(" (")[0].split(";")[0])} · retrieved ${esc(fig.retrieved)}</span>`;
}

// ---------- tree for the picture and the explore list ----------
/** Tree nodes for living-tree.js: cancer types sized by yearly new cases, genes underneath. */
export function publicTreeRoot() {
  const root = { name: "All", shown: 0, counted: 0, children: new Map(), summaries: [] };
  for (const c of publicData().cancers) {
    if (c.group === "agnostic") continue;
    const nc = (c.seer && c.seer.figures.newCases && c.seer.figures.newCases.value) || 1000;
    const node = { name: c.treeLabel, shown: 0, counted: 0, weight: nc, children: new Map(), summaries: [], cancer: c };
    for (const g of topGenes(c, 3)) node.children.set(g.gene, { name: g.gene, shown: 0, counted: 0, weight: Math.max(1, nc * g.pct / 100), children: new Map(), summaries: [] });
    root.children.set(c.treeLabel, node);
  }
  return root;
}

export function exploreListHtml() {
  const d = publicData();
  return d.groups.map((g) => {
    const items = d.cancers.filter((c) => c.group === g.id);
    if (!items.length) return "";
    return `<li><details><summary>${esc(g.name)} <span class="counts">${items.length} ${items.length === 1 ? "tree" : "trees"}</span></summary><ul>${items.map((c) => {
      const f = (c.seer && c.seer.figures) || {};
      const genes = topGenes(c, 4);
      return `<li><details><summary>${esc(c.name)} <span class="counts">0 patients shared</span></summary><div class="leaf">
        ${f.newCases ? `<p class="sub" style="margin:0 0 4px">${n(f.newCases.value)} estimated new U.S. cases in ${f.newCases.year}${f.survival5 ? `; ${f.survival5.value}% 5-year relative survival` : ""} (SEER).</p>` : ""}
        ${genes.length ? `<p class="sub" style="margin:0 0 4px">Most often mutated: ${genes.map((x) => `${esc(x.gene)} ${x.pct}%`).join(", ")} (TCGA via cBioPortal).</p>` : ""}
        <a class="link" href="${cancerPath(c)}">Open the ${esc(c.name)} page</a></div></details></li>`;
    }).join("")}</ul></details></li>`;
  }).join("");
}

/** The /cancers/ page: every cancer tree, grouped. */
export function cancersIndexHtml() {
  const d = publicData();
  return d.groups.map((g) => {
    const items = d.cancers.filter((c) => c.group === g.id);
    if (!items.length) return "";
    return `<section class="sec" aria-labelledby="cg-${esc(g.id)}"><h2 id="cg-${esc(g.id)}">${esc(g.name)}</h2><ul class="ci-list">${items.map((c) => {
      const f = (c.seer && c.seer.figures) || {};
      const subs = subPages(c);
      const facts = [f.newCases && `${n(f.newCases.value)} new U.S. cases a year`, f.survival5 && `${f.survival5.value}% alive after 5 years`].filter(Boolean).join(" · ");
      return `<li class="ci-item"><a class="ci-link" href="${cancerPath(c)}">${esc(c.name)}</a>
        <p class="sub ci-meta">${facts || "Gene and drug facts"}${subs.length ? ` · ${subs.length} ${subs.length === 1 ? "subtype or biomarker page" : "subtype and biomarker pages"}` : ""}</p></li>`;
    }).join("")}</ul></section>`;
  }).join("");
}

// ---------- left navigation (Primer NavList pattern) ----------
export function navHtml() {
  const d = publicData();
  const groups = d.groups.map((g) => {
    const items = d.cancers.filter((c) => c.group === g.id);
    if (!items.length) return "";
    return `<li class="nl-group" data-nl-group><h3 class="nl-group-h" id="nlg-${esc(g.id)}">${esc(g.name)}</h3>
      <ul class="nl-list" aria-labelledby="nlg-${esc(g.id)}">${items.map(itemHtml).join("")}</ul></li>`;
  }).join("");
  return `<h2 class="nl-title nl-ct" id="cancer-nav-title">${icon("git-branch", 16)}Cancer trees</h2>
    <div class="nl-search">
      <label class="field-label" for="nav-search">Search cancer types and genes</label>
      <input class="field" id="nav-search" type="search" autocomplete="off" spellcheck="false" placeholder="e.g. lung, EGFR, leukemia" aria-describedby="nav-search-status">
      <p class="sub nl-status" id="nav-search-status" role="status" aria-live="polite"></p>
    </div>
    <ul class="nl-groups">${groups}</ul>
    <p class="sub nl-foot"><a href="/cancers/">See all cancer trees on one page</a>. Published data from SEER, cBioPortal (TCGA), FDA labels and ClinicalTrials.gov. <a href="/sources/">Sources and licenses</a></p>`;
}
function itemHtml(c) {
  const genes = topGenes(c, 5);
  const subs = subPages(c);
  const st = subs.filter((s) => s.kind === "subtype"), bm = subs.filter((s) => s.kind === "biomarker");
  const search = [c.name, c.treeLabel, ...(c.synonyms || []), ...subs.map((s) => s.label), ...genes.map((g) => g.gene)].join(" ").toLowerCase();
  const hasKids = subs.length || genes.length;
  const kid = (href, label, extra = "") => `<li><a class="nl-sublink" href="${esc(href)}">${label}${extra}</a></li>`;
  const sub = hasKids ? `<ul class="nl-sub" id="nls-${esc(c.id)}" hidden>
      ${st.length ? `<li class="nl-subh" aria-hidden="true">Subtypes</li>${st.map((s) => kid(cancerPath(c, s), esc(s.label))).join("")}` : ""}
      ${bm.length ? `<li class="nl-subh" aria-hidden="true">Biomarkers with FDA-approved drugs</li>${bm.map((s) => kid(cancerPath(c, s), esc(s.label))).join("")}` : ""}
      ${genes.length ? `<li class="nl-subh" aria-hidden="true">Genes</li>${genes.map((g) => kid(`${cancerPath(c)}#${geneId(c, g.gene)}`, `<span class="mono-ish">${esc(g.gene)}</span>`, ` <span class="nl-meta">${g.pct}%</span>`)).join("")}` : ""}
    </ul>` : "";
  return `<li class="nl-item" data-nl-item data-search="${esc(search)}">
    <div class="nl-row"><a class="nl-link" href="${cancerPath(c)}" data-nl-cancer="${esc(c.id)}">${esc(c.name)}</a>
    ${hasKids ? `<button type="button" class="nl-toggle" aria-expanded="false" aria-controls="nls-${esc(c.id)}" aria-label="Show subtypes and genes for ${esc(c.name)}">${icon("chevron-down", 16)}</button>` : ""}</div>${sub}</li>`;
}

/** Wire search and the expand buttons. */
export function wireNav(root) {
  root.addEventListener("click", (e) => {
    const t = e.target.closest(".nl-toggle");
    if (!t) return;
    const open = t.getAttribute("aria-expanded") !== "true";
    t.setAttribute("aria-expanded", String(open));
    document.getElementById(t.getAttribute("aria-controls")).hidden = !open;
  });
  const input = root.querySelector("#nav-search");
  const status = root.querySelector("#nav-search-status");
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      root.querySelectorAll("[data-nl-item]").forEach((li) => {
        const hit = !q || q.split(/\s+/).every((w) => li.dataset.search.includes(w));
        li.hidden = !hit; if (hit) shown++;
        const t = li.querySelector(".nl-toggle");
        if (t) { const open = !!q && hit; t.setAttribute("aria-expanded", String(open)); document.getElementById(t.getAttribute("aria-controls")).hidden = !open; }
      });
      root.querySelectorAll("[data-nl-group]").forEach((g) => { g.hidden = !g.querySelector("[data-nl-item]:not([hidden])"); });
      status.textContent = q ? (shown ? `${shown} ${shown === 1 ? "cancer tree matches" : "cancer trees match"}.` : "No cancer trees match. Try another word.") : "";
    }, 150);
  });
}
/** Mark the current cancer (and sub-page) in the list and open its sub-list. */
export function markCurrent(root, id, path) {
  root.querySelectorAll("[data-nl-cancer]").forEach((a) => { if (a.dataset.nlCancer === id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  root.querySelectorAll(".nl-sublink").forEach((a) => { if (path && a.getAttribute("href") === path) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
}

// ---------- cancer pages ----------
const STAT_HELP = { newCases: "new-cases", deaths: "deaths", survival5: "survival", incidenceRate: "rate", medianAge: "median-age" };
function statCard(key, fig, big, extra = "") {
  if (!fig) return "";
  return `<div class="stat-card"><div class="hh"><p class="stat-label">${esc(fig.label)}</p>${helpTip(STAT_HELP[key], fig.label)}</div><p class="stat-big">${big}</p>${extra}${srcLine(fig)}</div>`;
}
const lowerName = (c) => (/^[A-Z]{2,}/.test(c.name) ? c.name : c.name.charAt(0).toLowerCase() + c.name.slice(1));
const geneOf = (biomarker) => String(biomarker).split(/[ /(]/)[0].replace(/-.*$/, "");
function crumbs(c, sub) {
  const items = [["/", "Home"], ["/cancers/", "Cancer trees"], [cancerPath(c), c.name]];
  if (sub) items.push([cancerPath(c, sub), sub.label]);
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map(([h, t], i) => `<li>${i === items.length - 1 ? `<a href="${h}" aria-current="page">${esc(t)}</a>` : `<a href="${h}">${esc(t)}</a>`}</li>`).join("")}</ol></nav>`;
}
function howToUse(id, steps) {
  return `<section class="sec how-use" aria-labelledby="${id}"><h2 id="${id}">${icon("list-ordered", 16)}How to use this page</h2><ol class="steps-ol">${steps.map((s) => `<li>${s}</li>`).join("")}</ol></section>`;
}
function onThisPage(links) {
  return `<nav class="otp" aria-label="On this page"><p class="otp-h">On this page:</p><ul>${links.filter(Boolean).map(([h, t]) => `<li><a href="#${h}">${t}</a></li>`).join("")}</ul></nav>`;
}
function patientsCard(c) {
  return `<div class="card patients-card"><div class="row"><span class="tile t-green" aria-hidden="true">${icon("people", 16)}</span><div class="grow">
      <div class="hh"><h2 class="h-inline">Patient-shared branches: <span class="pt-count">0</span></h2>${helpTip("shared-branches")}</div>
      <p class="sub" style="margin:0">Nobody has shared a branch on this tree yet. Shared branches will be counted here, apart from published research.</p></div></div>
      <button type="button" class="btn btn-primary" data-open-wizard style="margin-top:12px">Create your branch</button></div>`;
}
function trialsCard(t, what) {
  if (!t) return "";
  return `<div class="card"><div class="row"><span class="tile t-blue" aria-hidden="true">${icon("beaker", 16)}</span><div class="grow">
      <div class="hh"><h2 class="h-inline"><a href="${esc(t.url)}" rel="noopener" target="_blank">${n(t.value)} recruiting studies</a></h2>${helpTip("trial", "recruiting clinical trials")}</div>
      <p class="sub" style="margin:0">Clinical trials looking for people with ${esc(what)}, on ClinicalTrials.gov.</p></div></div><p class="sub" style="margin:8px 0 0">${srcLine(t)}</p></div>`;
}
function geneTable(c, g, geneIds) {
  return `<div class="table-box"><table class="data"><caption class="sr-only">Genes most often changed in ${esc(g.subtype)}</caption>
    <thead><tr><th scope="col">Gene</th><th scope="col">Tumors with a mutation</th><th scope="col">Recruiting trials</th></tr></thead>
    <tbody>${g.genes.map((x) => { const t = (c.geneTrials || {})[x.gene];
      const gid = !geneIds || geneIds.has(x.gene) ? "" : ` id="${geneId(c, x.gene)}" tabindex="-1"`; if (geneIds) geneIds.add(x.gene);
      return `<tr${gid}><th scope="row">${esc(x.gene)}</th><td>${x.pct}% <span class="sub">(${n(x.altered)} of ${n(x.profiled)})</span></td><td>${t ? `<a href="${esc(t.url)}" rel="noopener" target="_blank">${n(t.value)}</a>` : "–"}</td></tr>`; }).join("")}</tbody></table></div>`;
}
function therapyCard(c, t, withLink) {
  const s = subPages(c).find((x) => x.kind === "biomarker" && x.biomarker === t.biomarker);
  return `<div class="card therapy-card"><h3>${s && withLink ? `<a href="${cancerPath(c, s)}">${esc(s.label)}</a>` : esc(t.biomarker)}</h3>
    <ul class="drug-list">${t.drugs.map((x) => `<li><a href="${esc(x.url)}" rel="noopener" target="_blank"><strong>${esc(x.brand)}</strong></a> <span class="sub">(${esc(x.generic)}) · label updated ${esc(date(x.labelDate))}</span>
      <details><summary>What the FDA label says</summary><p class="excerpt">${esc(x.excerpt)}…</p></details></li>`).join("")}</ul>
    ${t.trials ? `<p class="sub" style="margin:8px 0 0"><a href="${esc(t.trials.url)}" rel="noopener" target="_blank">${n(t.trials.value)} recruiting studies</a> mention ${esc(geneOf(t.biomarker))} (ClinicalTrials.gov, retrieved ${esc(t.trials.retrieved)}).</p>` : ""}
    <p class="sub" style="margin:6px 0 0">${srcLine(t.drugs[0])}</p></div>`;
}
function sourcesSection(c, used) {
  const d = publicData();
  const list = [...used].map((k) => { const s = d.sources[k]; return s ? `<li><strong>${esc(s.name)}</strong>. License: <a href="${esc(s.licenseUrl)}" rel="noopener" target="_blank">${esc(s.license)}</a>. ${esc(s.note)}${k === "ctgov" && c.trials && c.trials.dataTimestamp ? ` ClinicalTrials.gov data processed ${esc(c.trials.dataTimestamp.slice(0, 10))}.` : ""}</li>` : ""; }).join("");
  return `<section class="sec sources" aria-labelledby="src-h-${esc(c.id)}"><div class="hh"><h2 id="src-h-${esc(c.id)}">Sources and licenses</h2>${helpTip("license", "sources and licenses")}</div><ul class="src-list">${list}</ul>
    <p class="sub">Figures saved ${esc(d.generated)}. <a href="/sources/">All sources</a></p></section>`;
}
const advice = `<p class="notice advice"><strong>This is not medical advice.</strong> These numbers describe large groups of people, not you. Talk with your doctor or care team before you make any choice about your care.</p>`;

/** The ready-made prompt for the patient's own AI. */
export function aiPrompt(c, sub) {
  const f = (c.seer && c.seer.figures) || {};
  const url = SITE + cancerPath(c, sub);
  const title = sub ? (sub.kind === "biomarker" ? `${sub.label} ${lowerName(c)}` : `${sub.label} (${lowerName(c)})`) : lowerName(c);
  const facts = [];
  if (f.newCases) facts.push(`${n(f.newCases.value)} estimated new U.S. cases of ${lowerName(c)} in ${f.newCases.year} (SEER).`);
  if (f.survival5) facts.push(`${f.survival5.value}% 5-year relative survival for ${lowerName(c)}, ${f.survival5.years} (SEER).`);
  if (f.byStage) facts.push(`5-year relative survival by stage: ${f.byStage.value.map((r) => `${r.stage.toLowerCase()} ${r.survival5}%`).join(", ")} (SEER).`);
  const studies = sub && sub.kind === "subtype" ? (c.genomics || []).filter((g) => g.subtype === sub.name) : (c.genomics || []);
  if (studies.length) facts.push(`Genes most often changed: ${topGenesOf(studies, 6).map((x) => `${x.gene} ${x.pct}%`).join(", ")} of tumors studied (TCGA via cBioPortal).`);
  const ther = sub && sub.kind === "biomarker" ? (c.therapies || []).filter((t) => t.biomarker === sub.biomarker) : (c.therapies || []);
  for (const t of ther) facts.push(`FDA-approved drugs for ${t.biomarker}: ${t.drugs.map((x) => `${x.brand} (${x.generic})`).join(", ")} (FDA labels).`);
  const tr = sub && sub.kind === "biomarker" ? (ther[0] && ther[0].trials) : c.trials;
  if (tr) facts.push(`${n(tr.value)} recruiting clinical trials on ClinicalTrials.gov: ${tr.url}`);
  return `I am reading about ${title} on CureBranch, a free website with facts from public sources:
${url}

Here is what that page says:
${facts.map((x) => `- ${x}`).join("\n") || "- (Open the link above to see the facts.)"}

Please help me understand my own situation:
1. Explain the facts above in plain, simple English.
2. Read my records below. Tell me which of these facts may apply to me and which do not.
3. Explain any medical words in my records.
4. Write a short list of questions I can ask my doctor at my next visit.

Please do not guess. If something is not in my records, say so. I know this is not medical advice, and my doctors make my care decisions.

My records (I removed my name, birthday, address and record numbers):
[Paste your pathology report, test results or visit notes here]`;
}
function topGenesOf(studies, k) {
  const seen = new Map();
  for (const g of studies) for (const x of g.genes) if (!seen.has(x.gene)) seen.set(x.gene, x);
  return [...seen.values()].sort((a, b) => b.pct - a.pct).slice(0, k);
}
const AIS = [
  ["ChatGPT", "https://chatgpt.com", "chatgpt.com"],
  ["Claude", "https://claude.ai", "claude.ai"],
  ["Gemini", "https://gemini.google.com", "gemini.google.com"],
  ["Grok", "https://grok.com", "grok.com"],
  ["Microsoft Copilot", "https://copilot.microsoft.com", "copilot.microsoft.com"],
];
function aiSection(c, sub) {
  const id = `ai-${c.id}${sub ? "-" + sub.slug : ""}`;
  const steps = (name, href, host) => `<ol class="steps-ol">
      <li>Press <strong>Copy the prompt</strong> above.</li>
      <li>Open <a href="${href}" rel="noopener" target="_blank">${host}</a> (or the ${esc(name)} app) and sign in.</li>
      <li>Click or tap the message box and paste. On a computer press Ctrl+V (Command+V on a Mac). On a phone, press and hold, then tap Paste.</li>
      <li>Replace the line in [brackets] with the parts of your records you want help with. Many AIs also let you add a PDF or photo with the + or paperclip button.</li>
      <li>Send it. Then ask follow-up questions in your own words.</li>
    </ol>`;
  return `<section class="sec ai-sec" id="${id}" tabindex="-1" aria-labelledby="${id}-h">
    <div class="hh"><h2 id="${id}-h">${icon("sparkle", 16)}How to use this with your AI</h2>${helpTip("ai", "your own AI")}</div>
    <p>You can ask an AI chat tool to explain this page and your own records together. CureBranch does not run any AI and never sees what you paste. We made a prompt for you. A prompt is the message you send to the AI.</p>
    <div class="card prompt-card">
      <label class="field-label" for="${id}-prompt">Your ready-made prompt (it includes this page's link and facts)</label>
      <textarea class="field prompt-box" id="${id}-prompt" rows="9" readonly>${esc(aiPrompt(c, sub))}</textarea>
      <div class="row prompt-actions"><button type="button" class="btn btn-primary" data-copy="${id}-prompt">${icon("copy", 16)}Copy the prompt</button>
      <span class="sub copy-status" role="status" aria-live="polite"></span></div>
    </div>
    <h3>Steps for your AI</h3>
    <div class="ai-steps">${AIS.map(([name, href, host], i) => `<details class="ai-how"${i === 0 ? " open" : ""}><summary>${esc(name)}</summary>${steps(name, href, host)}</details>`).join("")}
      <details class="ai-how"><summary>Another AI</summary><ol class="steps-ol"><li>Press <strong>Copy the prompt</strong> above.</li><li>Open your AI and start a new chat.</li><li>Paste the prompt, replace the line in [brackets] with your records, and send it.</li></ol></details></div>
    <div class="notice"><p style="margin:0 0 6px"><strong>Keep yourself safe:</strong></p><ul class="tight">
      <li>Leave out your name, birthday, address, phone and record numbers.</li>
      <li>Check the AI's privacy settings. Some let you choose if your chats are used to train it.</li>
      <li>AI can be wrong. Check what it says with your doctor.</li></ul></div>
    ${advice}
  </section>`;
}

export function cancerPageHtml(c, sub) {
  if (sub) return subPageHtml(c, sub);
  const d = publicData();
  const group = (d.groups.find((g) => g.id === c.group) || {}).name || "";
  const f = (c.seer && c.seer.figures) || {};
  const used = new Set();
  const subs = subPages(c);
  const stats = [
    f.newCases && statCard("newCases", f.newCases, n(f.newCases.value), f.pctNew ? `<p class="sub stat-sub">${f.pctNew.value}% of all new cancer cases</p>` : ""),
    f.deaths && statCard("deaths", f.deaths, n(f.deaths.value)),
    f.survival5 && statCard("survival5", f.survival5, `${f.survival5.value}%`, `<p class="sub stat-sub">About ${Math.round(f.survival5.value)} out of 100 people, compared with people of the same age who do not have this cancer</p>`),
    f.incidenceRate && statCard("incidenceRate", f.incidenceRate, String(f.incidenceRate.value)),
    f.medianAge && statCard("medianAge", f.medianAge, String(f.medianAge.value)),
  ].filter(Boolean);
  if (stats.length) used.add("seer");
  const stage = f.byStage ? `<section class="sec" aria-labelledby="stage-h-${esc(c.id)}">${helpHeading(2, `stage-h-${esc(c.id)}`, "By stage at diagnosis", "stage", "stage")}
    <p class="sub">How far the cancer had spread when people found out, and how many were alive 5 years later.</p>
    <div class="box table-box"><table class="data"><caption class="sr-only">${esc(f.byStage.label)}</caption>
    <thead><tr><th scope="col">Stage</th><th scope="col">Share of cases</th><th scope="col">5-year relative survival</th></tr></thead>
    <tbody>${f.byStage.value.map((r) => `<tr><th scope="row">${esc(r.stage)}</th><td>${r.pctCases}%</td><td>${r.survival5}%</td></tr>`).join("")}</tbody></table></div>
    <p class="sub">${srcLine(f.byStage)}</p></section>` : "";
  const st = subs.filter((s) => s.kind === "subtype"), bm = subs.filter((s) => s.kind === "biomarker");
  const subLinks = (st.length || bm.length) ? `<section class="sec" id="pages-${esc(c.id)}" tabindex="-1" aria-labelledby="pages-h-${esc(c.id)}">${helpHeading(2, `pages-h-${esc(c.id)}`, "Subtypes and biomarkers", "subtype", "subtype")}
      <p class="sub">Each one has its own page. If your report names one of these, start there.</p>
      ${st.length ? `<h3>Subtypes</h3><ul class="pill-links">${st.map((s) => `<li><a href="${cancerPath(c, s)}">${esc(s.label)}</a></li>`).join("")}</ul>` : ""}
      ${bm.length ? `<div class="hh"><h3>Biomarkers with FDA-approved drugs</h3>${helpTip("biomarker")}</div><ul class="pill-links">${bm.map((s) => `<li><a href="${cancerPath(c, s)}">${esc(s.label)}</a></li>`).join("")}</ul>` : ""}</section>` : "";
  const geneIds = new Set();
  const seerSubs = (c.seerSubtypes || []).map((s) => {
    const sf = s.figures || {}; used.add("seer");
    const sp = subs.find((x) => x.kind === "subtype" && x.name === s.name);
    return `<div class="card"><h3>${sp ? `<a href="${cancerPath(c, sp)}">${esc(s.name)}</a>` : esc(s.name)}</h3><p class="sub" style="margin:0 0 6px">${[
      sf.newCases && `${n(sf.newCases.value)} estimated new cases in ${sf.newCases.year}`, sf.survival5 && `${sf.survival5.value}% 5-year relative survival (${esc(sf.survival5.years)})`,
      sf.medianAge && `median age at diagnosis ${sf.medianAge.value}`].filter(Boolean).join("; ") || "See the SEER page for figures."}</p>${srcLine({ ...(sf.newCases || sf.survival5 || { source: "seer", url: s.url, retrieved: d.generated }) })}</div>`;
  }).join("");
  const genomics = (c.genomics || []).map((g) => {
    used.add("cbioportal"); if (Object.keys(c.geneTrials || {}).length) used.add("ctgov");
    const sp = subs.find((x) => x.kind === "subtype" && x.name === g.subtype);
    return `<div class="card gene-card"><h3>${sp ? `<a href="${cancerPath(c, sp)}">${esc(g.subtype)}</a>` : esc(g.subtype)}</h3>
      <p class="sub" style="margin:0 0 8px">${esc(g.studyName)}, ${esc(g.citation || "")}. ${g.genes[0] ? `${n(g.genes[0].profiled)} tumors studied.` : ""}</p>
      ${geneTable(c, g, geneIds)}
      <p class="sub" style="margin:8px 0 0">A change in a gene does not always mean it drives the cancer. ${srcLine(g)}</p></div>`;
  }).join("");
  const therapies = (c.therapies || []).map((t) => { used.add("openfda"); if (t.trials) used.add("ctgov"); return therapyCard(c, t, true); }).join("");
  if (c.trials) used.add("ctgov");
  const cid = esc(c.id);
  return `${crumbs(c)}
    <p class="eyebrow">${icon("git-branch", 16)}<span>${esc(group)} · cancer tree</span>${helpTip("cancer-tree")}</p>
    <h1 id="cancer-title">${esc(c.name)}</h1>
    ${whatIsBox(`wi-${cid}`, `<p>This page is about <strong>${esc(lowerName(c))}</strong>. It shows facts from trusted public sources: how many people get it, how many are alive after 5 years, which genes are often changed, which drugs are approved, and which studies are looking for people. Every number says where it came from.</p>
      <p class="sub" style="margin:0">These are numbers for big groups of people. They cannot tell you what will happen to you.</p>`)}
    ${howToUse(`how-${cid}`, [
      `Read <a href="#stats-h-${cid}">Key numbers</a> to see how common this cancer is. Press any <span class="q-sample" aria-hidden="true">?</span> button to learn what a word means.`,
      (st.length || bm.length) ? `Look at your pathology or test report. If it names a subtype or a marker like ${esc((bm[0] || st[0]).label)}, open that page under <a href="#pages-h-${cid}">Subtypes and biomarkers</a>.` : `Look at your pathology or test report and compare it with the gene list below.`,
      therapies ? `See <a href="#th-h-${cid}">FDA-approved drugs</a> that match a test result. Ask your doctor if the test was done for you.` : `Check <a href="#src-h-${cid}">where the numbers come from</a>.`,
      c.trials ? `See how many <strong>clinical trials</strong> are looking for people. The link opens ClinicalTrials.gov.` : `Ask your doctor about clinical trials.`,
      `Use <a href="#ai-${cid}-h">How to use this with your AI</a> to copy a ready-made prompt, paste it into your own AI, and add your records.`,
      `Bring your questions to your doctor. This page is not medical advice.`,
    ])}
    ${onThisPage([[`stats-h-${cid}`, "Key numbers"], f.byStage && [`stage-h-${cid}`, "By stage"], subLinks && [`pages-h-${cid}`, "Subtypes and biomarkers"], (seerSubs || genomics) && [`sub-h-${cid}`, "Gene changes"], therapies && [`th-h-${cid}`, "FDA-approved drugs"], [`ai-${cid}-h`, "Use with your AI"], [`src-h-${cid}`, "Sources"]])}
    <div class="cancer-grid">${patientsCard(c)}${trialsCard(c.trials, lowerName(c))}</div>
    ${stats.length ? `<section class="sec" aria-labelledby="stats-h-${cid}"><div class="hh"><h2 id="stats-h-${cid}">Key numbers (United States)</h2>${helpTip("seer", "SEER, where these numbers come from")}</div><div class="stat-grid">${stats.join("")}</div></section>`
      : `<section class="sec" aria-labelledby="stats-h-${cid}"><h2 id="stats-h-${cid}">Key numbers</h2><p class="notice">SEER does not publish a Cancer Stat Facts page for this group, so no U.S. statistics are shown.</p></section>`}
    ${stage}
    ${subLinks}
    ${seerSubs || genomics ? `<section class="sec" aria-labelledby="sub-h-${cid}"><div class="hh"><h2 id="sub-h-${cid}">Common gene changes</h2>${helpTip("mutation-rate", "tumors with a mutation")}${helpTip("tcga")}</div><p class="sub">The share of tumors in a big research study that had a change (mutation) in each gene.</p><div class="sub-grid">${seerSubs}${genomics}</div></section>` : ""}
    ${therapies ? `<section class="sec" id="therapies-${cid}" tabindex="-1" aria-labelledby="th-h-${cid}"><div class="hh"><h2 id="th-h-${cid}">FDA-approved drugs tied to a biomarker</h2>${helpTip("fda", "FDA-approved drug")}</div>
      <p class="sub">Listed when the drug's current FDA label names the biomarker and this cancer together. Ask your care team whether a test applies to you.</p><div class="sub-grid">${therapies}</div></section>` : ""}
    ${aiSection(c)}
    ${sourcesSection(c, used)}`;
}

function subPageHtml(c, sub) {
  const d = publicData();
  const used = new Set();
  const cid = `${esc(c.id)}-${esc(sub.slug)}`;
  const isBio = sub.kind === "biomarker";
  const title = isBio ? `${sub.label} ${lowerName(c)}` : sub.label;
  let body = "", what = "", steps = [];
  if (isBio) {
    const t = (c.therapies || []).find((x) => x.biomarker === sub.biomarker);
    const gene = geneOf(sub.biomarker);
    const row = (c.genomics || []).flatMap((g) => g.genes.map((x) => ({ ...x, g }))).find((x) => x.gene.toUpperCase() === gene.toUpperCase());
    used.add("openfda"); if (t.trials) used.add("ctgov"); if (row) used.add("cbioportal");
    what = `<p>This page is about ${esc(lowerName(c))} where a test found <strong>${esc(sub.biomarker)}</strong>. ${/wild-type/i.test(sub.biomarker) ? `"Wild-type" means no change was found in that gene.` : `"Positive" means the test found this marker in the cancer.`} It lists the drugs the FDA has approved for it, and studies looking for people.</p>
      <p class="sub" style="margin:0">Your pathology or genetic test report says if your cancer was tested for ${esc(gene)}. Ask your doctor if you are not sure.</p>`;
    steps = [`Check your test report for <strong>${esc(sub.biomarker)}</strong>. If it is not there, ask your doctor if the test was done.`,
      `Read the <a href="#drugs-${cid}">FDA-approved drugs</a>. Each name opens the drug's official label.`,
      t.trials ? `See how many clinical trials mention ${esc(gene)}.` : `Ask your doctor about clinical trials.`,
      `Copy the prompt in <a href="#ai-${cid}-h">How to use this with your AI</a> and add your records.`, `Talk with your doctor before any choice.`];
    body = `${t.trials ? `<div class="cancer-grid">${trialsCard({ ...t.trials }, `${lowerName(c)} and ${gene}`)}${row ? `<div class="card"><div class="hh"><h2 class="h-inline">${row.pct}% of tumors</h2>${helpTip("mutation-rate", "tumors with a mutation")}</div><p class="sub" style="margin:0">had a change in ${esc(row.gene)} in a large study of ${esc(row.g.subtype.toLowerCase())} (${n(row.altered)} of ${n(row.profiled)}).</p><p class="sub" style="margin:8px 0 0">${srcLine(row.g)}</p></div>` : ""}</div>` : ""}
      <section class="sec" id="drugs-${cid}" tabindex="-1" aria-labelledby="drugs-h-${cid}"><div class="hh"><h2 id="drugs-h-${cid}">FDA-approved drugs for ${esc(sub.biomarker)}</h2>${helpTip("fda", "FDA-approved drug")}</div>
        <p class="sub">Each drug's current FDA label names ${esc(sub.biomarker)} and ${esc(lowerName(c))} together. Press "What the FDA label says" to read the exact words.</p>
        <div class="sub-grid">${therapyCard(c, t, false)}</div></section>`;
  } else {
    const g = (c.genomics || []).find((x) => x.subtype === sub.name);
    const s = (c.seerSubtypes || []).find((x) => x.name === sub.name);
    what = `<p>This page is about <strong>${esc(sub.label)}</strong>, a subtype of ${esc(lowerName(c))}. ${esc(TERMS_SUBTYPE)}</p>`;
    steps = [`Check if your pathology report names this subtype.`,
      g ? `Look at <a href="#genes-${cid}">which genes are often changed</a>. A test on your tumor shows which changes you have.` : `Read the numbers below for this subtype.`,
      `Go back to the <a href="${cancerPath(c)}">${esc(c.name)} page</a> for drugs and trials.`,
      `Copy the prompt in <a href="#ai-${cid}-h">How to use this with your AI</a> and add your records.`, `Talk with your doctor before any choice.`];
    if (s) { used.add("seer"); const sf = s.figures || {};
      body += `<section class="sec" aria-labelledby="num-h-${cid}"><div class="hh"><h2 id="num-h-${cid}">Key numbers (United States)</h2>${helpTip("seer")}</div><div class="stat-grid">${[
        sf.newCases && statCard("newCases", sf.newCases, n(sf.newCases.value)), sf.survival5 && statCard("survival5", sf.survival5, `${sf.survival5.value}%`), sf.medianAge && statCard("medianAge", sf.medianAge, String(sf.medianAge.value))].filter(Boolean).join("") || `<p class="sub">See the <a href="${esc(s.url)}" rel="noopener" target="_blank">SEER page</a> for figures.</p>`}</div></section>`; }
    if (g) { used.add("cbioportal"); if (Object.keys(c.geneTrials || {}).length) used.add("ctgov");
      body += `<section class="sec" id="genes-${cid}" tabindex="-1" aria-labelledby="genes-h-${cid}"><div class="hh"><h2 id="genes-h-${cid}">Genes most often changed</h2>${helpTip("mutation-rate", "tumors with a mutation")}${helpTip("tcga")}</div>
        <p class="sub">${esc(g.studyName)}, ${esc(g.citation || "")}. ${g.genes[0] ? `${n(g.genes[0].profiled)} tumors studied.` : ""}</p>${geneTable(c, g, null)}
        <p class="sub" style="margin:8px 0 0">A change in a gene does not always mean it drives the cancer. ${srcLine(g)}</p></section>`; }
    const bm = subPages(c).filter((x) => x.kind === "biomarker");
    if (bm.length) body += `<section class="sec" aria-labelledby="bm-h-${cid}"><div class="hh"><h2 id="bm-h-${cid}">Biomarkers with FDA-approved drugs in ${esc(lowerName(c))}</h2>${helpTip("biomarker")}</div><ul class="pill-links">${bm.map((x) => `<li><a href="${cancerPath(c, x)}">${esc(x.label)}</a></li>`).join("")}</ul></section>`;
  }
  return `${crumbs(c, sub)}
    <p class="eyebrow">${icon("git-branch", 16)}<span>${esc(c.name)} · ${isBio ? "biomarker" : "subtype"}</span>${helpTip(isBio ? "biomarker" : "subtype")}</p>
    <h1 id="cancer-title">${esc(title)}</h1>
    ${whatIsBox(`wi-${cid}`, what)}
    ${howToUse(`how-${cid}`, steps)}
    ${body}
    <p><a class="btn btn-ghost" href="${cancerPath(c)}">${icon("arrow-left", 16)}All of ${esc(lowerName(c))}</a></p>
    ${aiSection(c, sub)}
    ${sourcesSection(c, used)}`;
}
const TERMS_SUBTYPE = "A subtype is a smaller group inside one cancer type. Subtypes can grow and respond to treatment differently.";

export function sourcesPageHtml() {
  const d = publicData();
  return `<h1 id="sources-title">Sources and licenses</h1>
    ${whatIsBox("wi-sources", `<p>This page lists every public source CureBranch uses for its numbers, and the rules (licenses) for using each one. You do not need this page to use the site. It is here so anyone can check our work.</p>`)}
    <p>Every published figure in CureBranch comes from one of these public sources and shows where it came from. Figures were saved on ${esc(d.generated)} by <span class="mono">tools/fetch-public-data.mjs</span>. Patient-shared branches are counted separately and start at zero.</p>
    <ul class="src-list">${Object.values(d.sources).map((s) => `<li><strong>${esc(s.name)}</strong><br>License: <a href="${esc(s.licenseUrl)}" rel="noopener" target="_blank">${esc(s.license)}</a>. ${esc(s.note)}</li>`).join("")}</ul>
    <p class="sub">The examples in Add records, under "Just trying it out?", are made-up records for trying the app. They are labelled EXAMPLE and never counted.</p>`;
}

/** Short published summary for a branch path [cancer label, gene?]. */
export function branchPublicHtml(path) {
  const c = cancerByLabel(path && path[0]);
  if (!c) return `<div class="card"><p class="sub" style="margin:0">No published data is linked to this branch yet.</p></div>`;
  const f = (c.seer && c.seer.figures) || {};
  const gene = path[1];
  const gRow = gene && (c.genomics || []).flatMap((g) => g.genes.map((x) => ({ ...x, g }))).find((x) => x.gene === gene);
  const ther = gene ? (c.therapies || []).filter((t) => t.biomarker.toUpperCase().includes(String(gene).toUpperCase())) : [];
  const lines = [];
  if (f.newCases) lines.push(`<li>${n(f.newCases.value)} estimated new U.S. cases of ${esc(c.name.toLowerCase())} in ${f.newCases.year}. ${srcLine(f.newCases)}</li>`);
  if (f.survival5) lines.push(`<li>${f.survival5.value}% 5-year relative survival (${esc(f.survival5.years)}). ${srcLine(f.survival5)}</li>`);
  if (gRow) lines.push(`<li>${esc(gene)} is mutated in ${gRow.pct}% of ${esc(gRow.g.subtype.toLowerCase())} tumors profiled (${n(gRow.altered)} of ${n(gRow.profiled)}). ${srcLine(gRow.g)}</li>`);
  for (const t of ther) lines.push(`<li>FDA-approved for ${esc(t.biomarker)}: ${t.drugs.map((x) => esc(x.brand)).join(", ")}. ${srcLine(t.drugs[0])}</li>`);
  if (!gRow && !ther.length && (c.therapies || []).length) lines.push(`<li>${c.therapies.length} biomarkers with FDA-approved drugs on the ${esc(c.name)} page. ${srcLine(c.therapies[0].drugs[0])}</li>`);
  return `<div class="card"><p class="status-line" style="margin:0 0 6px">Patient-shared branches here: 0</p>
    <p class="sub">Nobody has shared on this branch yet. What published research says:</p>
    <ul class="pub-list">${lines.join("")}</ul>
    <a class="btn btn-ghost" href="${cancerPath(c)}">${icon("arrow-right", 16)}Open the ${esc(c.name)} page</a></div>`;
}
