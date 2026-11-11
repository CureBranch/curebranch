// Published, aggregate cancer data (app/data/public-cancer-data.json, made by
// tools/fetch-public-data.mjs). Renders the cancer-tree navigation, the cancer pages and
// the "what published research says" panels. No patient data here: patient-shared
// branches start at zero and are counted separately from published figures.
import { icon } from "./octicons.js";

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
const subId = (c, i) => `sub-${c.id}-${i}`;

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
        <a class="link" href="#cancer/${esc(c.id)}" data-go="cancer/${esc(c.id)}">Open the ${esc(c.name)} page</a></div></details></li>`;
    }).join("")}</ul></details></li>`;
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
  return `<div class="nl-head">
      <h2 class="nl-title" id="sidenav-title">${icon("git-branch", 16)}Cancer trees</h2>
      <button type="button" class="nl-close" id="nav-close" aria-label="Close cancer trees menu">${icon("x", 16)}</button>
    </div>
    <div class="nl-search">
      <label class="field-label" for="nav-search">Search cancer types and genes</label>
      <input class="field" id="nav-search" type="search" autocomplete="off" spellcheck="false" placeholder="e.g. lung, EGFR, leukemia" aria-describedby="nav-search-status">
      <p class="sub nl-status" id="nav-search-status" role="status" aria-live="polite"></p>
    </div>
    <ul class="nl-groups">${groups}</ul>
    <p class="sub nl-foot">Published data from SEER, cBioPortal (TCGA), FDA labels and ClinicalTrials.gov. <a href="#sources" data-go="sources">Sources and licenses</a></p>`;
}
function itemHtml(c) {
  const genes = topGenes(c, 5);
  const subs = [...(c.genomics || []).map((g) => g.subtype), ...(c.seerSubtypes || []).map((s) => s.name)];
  const uniqSubs = [...new Set(subs)].filter((s) => s.toLowerCase() !== c.name.toLowerCase());
  const bio = [...new Set((c.therapies || []).map((t) => t.biomarker))];
  const search = [c.name, c.treeLabel, ...(c.synonyms || []), ...uniqSubs, ...genes.map((g) => g.gene), ...bio].join(" ").toLowerCase();
  const hasKids = uniqSubs.length || genes.length || bio.length;
  const kid = (href, label, extra = "") => `<li><a class="nl-sublink" href="#${esc(href)}" data-go="${esc(href)}">${label}${extra}</a></li>`;
  const sub = hasKids ? `<ul class="nl-sub" id="nls-${esc(c.id)}" hidden>
      ${uniqSubs.length ? `<li class="nl-subh" aria-hidden="true">Subtypes</li>${uniqSubs.map((s, i) => kid(`cancer/${c.id}/${subId(c, i)}`, esc(s))).join("")}` : ""}
      ${genes.length ? `<li class="nl-subh" aria-hidden="true">Genes</li>${genes.map((g) => kid(`cancer/${c.id}/${geneId(c, g.gene)}`, `<span class="mono-ish">${esc(g.gene)}</span>`, ` <span class="nl-meta">${g.pct}%</span>`)).join("")}` : ""}
      ${bio.length ? `<li class="nl-subh" aria-hidden="true">Biomarkers with FDA-approved drugs</li>${bio.map((b) => kid(`cancer/${c.id}/therapies-${c.id}`, esc(b))).join("")}` : ""}
    </ul>` : "";
  return `<li class="nl-item" data-nl-item data-search="${esc(search)}">
    <div class="nl-row"><a class="nl-link" href="#cancer/${esc(c.id)}" data-go="cancer/${esc(c.id)}" data-nl-cancer="${esc(c.id)}">${esc(c.name)}</a>
    ${hasKids ? `<button type="button" class="nl-toggle" aria-expanded="false" aria-controls="nls-${esc(c.id)}" aria-label="Show subtypes and genes for ${esc(c.name)}">${icon("chevron-down", 16)}</button>` : ""}</div>${sub}</li>`;
}

/** Wire search, expand buttons and the phone drawer. onNavigate is called after a link is used. */
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
export function markCurrent(root, id) {
  root.querySelectorAll("[data-nl-cancer]").forEach((a) => { if (a.dataset.nlCancer === id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
}

// ---------- cancer page ----------
function statCard(fig, big, extra = "") {
  if (!fig) return "";
  return `<div class="stat-card"><p class="stat-label">${esc(fig.label)}</p><p class="stat-big">${big}</p>${extra}${srcLine(fig)}</div>`;
}
export function cancerPageHtml(c) {
  const d = publicData();
  const group = (d.groups.find((g) => g.id === c.group) || {}).name || "";
  const f = (c.seer && c.seer.figures) || {};
  const used = new Set();
  const stats = [
    f.newCases && statCard(f.newCases, n(f.newCases.value), f.pctNew ? `<p class="sub stat-sub">${f.pctNew.value}% of all new cancer cases</p>` : ""),
    f.deaths && statCard(f.deaths, n(f.deaths.value)),
    f.survival5 && statCard(f.survival5, `${f.survival5.value}%`, `<p class="sub stat-sub">Compared with people of the same age who do not have this cancer</p>`),
    f.incidenceRate && statCard(f.incidenceRate, String(f.incidenceRate.value)),
    f.medianAge && statCard(f.medianAge, String(f.medianAge.value)),
  ].filter(Boolean);
  if (stats.length) used.add("seer");
  const stage = f.byStage ? `<section class="sec" aria-labelledby="stage-h-${esc(c.id)}"><h2 id="stage-h-${esc(c.id)}">By stage at diagnosis</h2>
    <div class="box table-box"><table class="data"><caption class="sr-only">${esc(f.byStage.label)}</caption>
    <thead><tr><th scope="col">Stage</th><th scope="col">Share of cases</th><th scope="col">5-year relative survival</th></tr></thead>
    <tbody>${f.byStage.value.map((r) => `<tr><th scope="row">${esc(r.stage)}</th><td>${r.pctCases}%</td><td>${r.survival5}%</td></tr>`).join("")}</tbody></table></div>
    <p class="sub">${srcLine(f.byStage)}</p></section>` : "";
  const subtypes = [...new Set([...(c.genomics || []).map((g) => g.subtype), ...(c.seerSubtypes || []).map((s) => s.name)])].filter((s) => s.toLowerCase() !== c.name.toLowerCase());
  const seerSubs = (c.seerSubtypes || []).map((s, i) => {
    const sf = s.figures || {};
    const idx = subtypes.indexOf(s.name);
    used.add("seer");
    return `<div class="card" id="${subId(c, idx)}" tabindex="-1"><h3>${esc(s.name)}</h3><p class="sub" style="margin:0 0 6px">${[
      sf.newCases && `${n(sf.newCases.value)} estimated new cases in ${sf.newCases.year}`, sf.survival5 && `${sf.survival5.value}% 5-year relative survival (${esc(sf.survival5.years)})`,
      sf.medianAge && `median age at diagnosis ${sf.medianAge.value}`].filter(Boolean).join("; ") || "See the SEER page for figures."}</p>${srcLine({ ...(sf.newCases || sf.survival5 || { source: "seer", url: s.url, retrieved: d.generated }) })}</div>`;
  }).join("");
  const geneIds = new Set();
  const genomics = (c.genomics || []).map((g) => {
    used.add("cbioportal");
    const idx = subtypes.indexOf(g.subtype);
    return `<div class="card gene-card" id="${subId(c, idx)}" tabindex="-1"><h3>${esc(g.subtype)}</h3>
      <p class="sub" style="margin:0 0 8px">${esc(g.studyName)}, ${esc(g.citation || "")}. ${g.genes[0] ? `${n(g.genes[0].profiled)} tumors profiled.` : ""}</p>
      <div class="table-box"><table class="data"><caption class="sr-only">Genes most often mutated in ${esc(g.subtype)}</caption>
      <thead><tr><th scope="col">Gene</th><th scope="col">Tumors with a mutation</th><th scope="col">Recruiting trials</th></tr></thead>
      <tbody>${g.genes.map((x) => { const t = (c.geneTrials || {})[x.gene]; if (t) used.add("ctgov");
        const gid = geneIds.has(x.gene) ? "" : ` id="${geneId(c, x.gene)}" tabindex="-1"`; geneIds.add(x.gene);
        return `<tr${gid}><th scope="row">${esc(x.gene)}</th><td>${x.pct}% <span class="sub">(${n(x.altered)} of ${n(x.profiled)})</span></td><td>${t ? `<a href="${esc(t.url)}" rel="noopener" target="_blank">${n(t.value)}</a>` : "–"}</td></tr>`; }).join("")}</tbody></table></div>
      <p class="sub" style="margin:8px 0 0">A mutation in a gene does not always mean it drives the cancer. ${srcLine(g)}</p></div>`;
  }).join("");
  const therapies = (c.therapies || []).map((t) => {
    used.add("openfda"); if (t.trials) used.add("ctgov");
    return `<div class="card therapy-card"><h3>${esc(t.biomarker)}</h3>
      <ul class="drug-list">${t.drugs.map((x) => `<li><a href="${esc(x.url)}" rel="noopener" target="_blank"><strong>${esc(x.brand)}</strong></a> <span class="sub">(${esc(x.generic)}) · label updated ${esc(date(x.labelDate))}</span>
        <details><summary>What the FDA label says</summary><p class="excerpt">${esc(x.excerpt)}…</p></details></li>`).join("")}</ul>
      ${t.trials ? `<p class="sub" style="margin:8px 0 0"><a href="${esc(t.trials.url)}" rel="noopener" target="_blank">${n(t.trials.value)} recruiting studies</a> mention ${esc(t.biomarker.split(/[ /(]/)[0])} (ClinicalTrials.gov, retrieved ${esc(t.trials.retrieved)}).</p>` : ""}
      <p class="sub" style="margin:6px 0 0">${srcLine(t.drugs[0])}</p></div>`;
  }).join("");
  if (c.trials) used.add("ctgov");
  const srcList = [...used].map((k) => { const s = d.sources[k]; return s ? `<li><strong>${esc(s.name)}</strong>. License: <a href="${esc(s.licenseUrl)}" rel="noopener" target="_blank">${esc(s.license)}</a>. ${esc(s.note)}${k === "ctgov" && c.trials && c.trials.dataTimestamp ? ` ClinicalTrials.gov data processed ${esc(c.trials.dataTimestamp.slice(0, 10))}.` : ""}</li>` : ""; }).join("");
  return `<p class="eyebrow">${icon("git-branch", 16)}<span>${esc(group)} · cancer tree</span></p>
    <h1 id="cancer-title">${esc(c.name)}</h1>
    <p class="sub">Published figures from public sources, each with its source. Information, not medical advice.</p>
    <div class="cancer-grid">
      <div class="card patients-card"><div class="row"><span class="tile t-green" aria-hidden="true">${icon("people", 16)}</span><div class="grow">
        <h2 class="h-inline">Patient-shared branches: <span class="pt-count">0</span></h2>
        <p class="sub" style="margin:0">Nobody has shared a branch on this tree yet. Shared branches will be counted here, apart from published research.</p></div></div>
        <button type="button" class="btn btn-primary" data-open-wizard style="margin-top:12px">Create your branch</button></div>
      ${c.trials ? `<div class="card"><div class="row"><span class="tile t-blue" aria-hidden="true">${icon("beaker", 16)}</span><div class="grow">
        <h2 class="h-inline"><a href="${esc(c.trials.url)}" rel="noopener" target="_blank">${n(c.trials.value)} recruiting studies</a></h2>
        <p class="sub" style="margin:0">Search for "${esc(c.name)}" on ClinicalTrials.gov.</p></div></div><p class="sub" style="margin:8px 0 0">${srcLine(c.trials)}</p></div>` : ""}
    </div>
    ${stats.length ? `<section class="sec" aria-labelledby="stats-h-${esc(c.id)}"><h2 id="stats-h-${esc(c.id)}">Key numbers (United States)</h2><div class="stat-grid">${stats.join("")}</div></section>` : `<p class="notice">SEER does not publish a Cancer Stat Facts page for this cancer, so no U.S. statistics are shown.</p>`}
    ${stage}
    ${seerSubs || genomics ? `<section class="sec" aria-labelledby="sub-h-${esc(c.id)}"><h2 id="sub-h-${esc(c.id)}">Subtypes and common gene changes</h2><div class="sub-grid">${seerSubs}${genomics}</div></section>` : ""}
    ${therapies ? `<section class="sec" id="therapies-${esc(c.id)}" tabindex="-1" aria-labelledby="th-h-${esc(c.id)}"><h2 id="th-h-${esc(c.id)}">FDA-approved drugs tied to a biomarker or target</h2>
      <p class="sub">Listed when the drug's current FDA label names the biomarker and this cancer in the same indication. Ask your care team whether a test applies to you.</p><div class="sub-grid">${therapies}</div></section>` : ""}
    <section class="sec sources" aria-labelledby="src-h-${esc(c.id)}"><h2 id="src-h-${esc(c.id)}">Sources and licenses</h2><ul class="src-list">${srcList}</ul>
      <p class="sub">Figures saved ${esc(d.generated)}. <a href="#sources" data-go="sources">All sources</a></p></section>`;
}

export function sourcesPageHtml() {
  const d = publicData();
  return `<h1 id="sources-title">Sources and licenses</h1>
    <p>Every published figure in CureBranch comes from one of these public sources and shows where it came from. Figures were saved on ${esc(d.generated)} by <span class="mono">tools/fetch-public-data.mjs</span>. Patient-shared branches are counted separately and start at zero.</p>
    <ul class="src-list">${Object.values(d.sources).map((s) => `<li><strong>${esc(s.name)}</strong><br>License: <a href="${esc(s.licenseUrl)}" rel="noopener" target="_blank">${esc(s.license)}</a>. ${esc(s.note)}</li>`).join("")}</ul>
    <p class="sub">The examples in Import, under "Just trying it out?", are made-up records for trying the app. They are labelled EXAMPLE and never counted.</p>`;
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
    <a class="btn btn-ghost" href="#cancer/${esc(c.id)}" data-go="cancer/${esc(c.id)}">${icon("arrow-right", 16)}Open the ${esc(c.name)} page</a></div>`;
}
