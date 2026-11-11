// Pulls REAL published figures for each cancer tree into app/data/public-cancer-data.json.
// Run by hand (needs the internet): node tools/fetch-public-data.mjs
// The site build does not call these services; it ships the saved file.
// Every figure carries its source, licence and retrieval date. Nothing is estimated here:
// if a source does not give a number, the app shows nothing for it.
import { writeFileSync } from "node:fs";
import { CANCERS, GROUPS, CANCER_GENES } from "./public-data-catalog.mjs";

const OUT = new URL("../app/data/public-cancer-data.json", import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);
const UA = { "User-Agent": "CureBranch public-data builder (https://curebranch.ai)" };

export const SOURCES = {
  seer: { name: "SEER Cancer Stat Facts, National Cancer Institute", license: "Public domain (U.S. Government work)",
    licenseUrl: "https://seer.cancer.gov/statfacts/html/all.html", note: "\"All material in this report is in the public domain and may be reproduced or copied without permission; citation as to source, however, is appreciated.\" Estimates of new cases and deaths are American Cancer Society projections reported by SEER." },
  cbioportal: { name: "cBioPortal for Cancer Genomics: TCGA PanCancer Atlas studies", license: "ODC Open Database License (ODbL) 1.0; TCGA open-access data",
    licenseUrl: "https://docs.cbioportal.org/user-guide/faq/", note: "Counts of tumor samples with at least one reported mutation in the gene, out of samples profiled. Please cite cBioPortal (Cerami et al. Cancer Discov 2012; Gao et al. Sci Signal 2013; de Bruijn et al. Cancer Res 2023) and the TCGA PanCancer Atlas (Cell 2018). The derived figures in this file are offered under the ODbL." },
  openfda: { name: "openFDA drug labels, U.S. Food and Drug Administration", license: "Public domain (CC0 1.0)", licenseUrl: "https://open.fda.gov/license/",
    note: "A drug is listed when its current FDA label names the biomarker and the cancer in the same indication. Not medical advice; read the full label." },
  ctgov: { name: "ClinicalTrials.gov, U.S. National Library of Medicine", license: "Free to use with attribution (ClinicalTrials.gov terms and conditions)",
    licenseUrl: "https://clinicaltrials.gov/about-site/terms-conditions", note: "Number of studies with status Recruiting that match the condition search (and the gene, where shown). Not modified other than counting." },
};

async function get(url, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) } });
      if (r.status === 404) return null;
      if (r.ok) return r;
    } catch {}
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}
const num = (s) => (s == null ? null : Number(String(s).replace(/,/g, "")));
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&ndash;/g, "–").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8211;/g, "–").replace(/\s+/g, " ");

async function seer(slug) {
  const url = `https://seer.cancer.gov/statfacts/html/${slug}.html`;
  const r = await get(url); if (!r) return null;
  const html = await r.text(); const t = text(html);
  const title = (/<title>([^<]+)<\/title>/.exec(html) || [])[1]?.replace(/\s*(&mdash;|—|-)\s*Cancer Stat Facts.*/, "").trim();
  const src = { source: "seer", url, retrieved: TODAY };
  const out = { title, url, figures: {} };
  let m;
  if ((m = /Estimated New Cases in (\d{4}) ([\d,]+)/.exec(t))) out.figures.newCases = { value: num(m[2]), year: +m[1], label: `Estimated new cases in ${m[1]} (U.S.)`, ...src };
  if ((m = /% of All New Cancer Cases ([\d.]+)%/.exec(t))) out.figures.pctNew = { value: +m[1], unit: "%", label: "Share of all new cancer cases", ...src };
  if ((m = /Estimated Deaths in (\d{4}) ([\d,]+)/.exec(t))) out.figures.deaths = { value: num(m[2]), year: +m[1], label: `Estimated deaths in ${m[1]} (U.S.)`, ...src };
  if ((m = /5-Year Relative Survival ([\d.]+)% (\d{4})–(\d{4})/.exec(t))) out.figures.survival5 = { value: +m[1], unit: "%", years: `${m[2]}–${m[3]}`, label: `5-year relative survival (${m[2]}–${m[3]})`, ...src };
  if ((m = /The rate of new cases of .*? was ([\d.]+) per 100,000 ([a-z ]+?) per year\. The death rate was ([\d.]+) per 100,000 [a-z ]+? per year\. These rates are age-adjusted and based on (\d{4}–\d{4}) cases and (\d{4}–\d{4}) deaths/.exec(t))) {
    out.figures.incidenceRate = { value: +m[1], unit: `per 100,000 ${m[2]} per year`, years: m[4], label: `New cases per 100,000 ${m[2]} per year, age-adjusted (${m[4]})`, ...src };
    out.figures.deathRate = { value: +m[3], unit: `per 100,000 ${m[2]} per year`, years: m[5], label: `Deaths per 100,000 ${m[2]} per year, age-adjusted (${m[5]})`, ...src };
  }
  if ((m = /Median Age At Diagnosis (\d+)/.exec(t))) out.figures.medianAge = { value: +m[1], label: "Median age at diagnosis", ...src };
  const stages = [];
  for (const [k, re] of [["Localized", /Localized Confined to Primary Site (\d+)% ([\d.]+)%/], ["Regional", /Regional Spread to Regional Lymph Nodes (\d+)% ([\d.]+)%/],
    ["Distant", /Distant Cancer Has Metastasized (\d+)% ([\d.]+)%/], ["Unknown", /Unknown Unstaged (\d+)% ([\d.]+)%/]]) {
    if ((m = re.exec(t))) stages.push({ stage: k, pctCases: +m[1], survival5: +m[2] });
  }
  if (stages.length) out.figures.byStage = { value: stages, label: "Percent of cases and 5-year relative survival by stage at diagnosis", ...src };
  return Object.keys(out.figures).length ? out : null;
}

async function tcga(studyId, subtype) {
  const sr = await get(`https://www.cbioportal.org/api/studies/${studyId}`); if (!sr) return null;
  const st = await sr.json();
  const r = await get("https://www.cbioportal.org/api/mutated-genes/fetch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studyIds: [studyId] }) });
  if (!r) return null;
  const rows = (await r.json()).filter((g) => CANCER_GENES.includes(g.hugoGeneSymbol) && g.numberOfProfiledCases > 0)
    .sort((a, b) => b.numberOfAlteredCases - a.numberOfAlteredCases).slice(0, 8);
  return {
    studyId, subtype, studyName: st.name, citation: st.citation, pmid: (st.pmid || "").split(",")[0] || null,
    url: `https://www.cbioportal.org/study/summary?id=${studyId}`, source: "cbioportal", retrieved: TODAY,
    genes: rows.map((g) => ({ gene: g.hugoGeneSymbol, altered: g.numberOfAlteredCases, profiled: g.numberOfProfiledCases,
      pct: Math.round((1000 * g.numberOfAlteredCases) / g.numberOfProfiledCases) / 10 })),
  };
}

let ctTimestamp = null;
async function ctCount(cond, term) {
  const q = new URLSearchParams({ "query.cond": cond, "filter.overallStatus": "RECRUITING", countTotal: "true", pageSize: "1", fields: "NCTId" });
  if (term) q.set("query.term", term);
  const r = await get(`https://clinicaltrials.gov/api/v2/studies?${q}`); if (!r) return null;
  const d = await r.json();
  const web = new URLSearchParams({ cond, aggFilters: "status:rec" }); if (term) web.set("term", term);
  return { value: d.totalCount, label: term ? `Recruiting studies mentioning ${term}` : "Recruiting studies", url: `https://clinicaltrials.gov/search?${web}`,
    source: "ctgov", retrieved: TODAY, dataTimestamp: ctTimestamp };
}

const labelCache = new Map();
async function label(brand) {
  if (labelCache.has(brand)) return labelCache.get(brand);
  const q = `openfda.brand_name:"${brand}"`;
  const r = await get(`https://api.fda.gov/drug/label.json?search=${encodeURIComponent(q)}&limit=20`);
  const res = r ? (await r.json()).results || [] : [];
  const exact = res.filter((x) => (x.openfda?.brand_name || []).some((b) => b.toUpperCase() === brand.toUpperCase()));
  const pick = (exact.length ? exact : res).sort((a, b) => String(b.effective_time).localeCompare(String(a.effective_time)))[0] || null;
  labelCache.set(brand, pick);
  await new Promise((res2) => setTimeout(res2, 250));
  return pick;
}
function sameIndication(ind, bioRe, cancerRe) {
  // The biomarker and the cancer must appear within one indication (about one bullet).
  const parts = ind.split(/•|\u2022|\n|(?=\b1\.\d+\s)|;\s/);
  for (const p of parts) if (bioRe.test(p) && cancerRe.test(p)) return p.trim();
  const re = new RegExp(`(${cancerRe.source})[^.]{0,260}(${bioRe.source})|(${bioRe.source})[^.]{0,260}(${cancerRe.source})`, "i");
  const m = re.exec(ind);
  return m ? m[0] : null;
}

async function main() {
  const v = await get("https://clinicaltrials.gov/api/v2/version"); ctTimestamp = v ? (await v.json()).dataTimestamp : null;
  const cancers = [];
  for (const c of CANCERS) {
    process.stdout.write(`${c.id} `);
    const e = { id: c.id, name: c.name, treeLabel: c.treeLabel, group: c.group, synonyms: c.syn || [] };
    if (c.seer) e.seer = await seer(c.seer);
    e.seerSubtypes = [];
    for (const [slug, name] of c.seerSub || []) { const s = await seer(slug); if (s) e.seerSubtypes.push({ name, ...s }); }
    e.genomics = [];
    for (const [sid, sub] of c.tcga || []) { const g = await tcga(sid, sub); if (g && g.genes.length) e.genomics.push(g); }
    e.trials = await ctCount(c.ct);
    const cancerRe = new RegExp(c.cancerRe, "i");
    e.therapies = [];
    for (const [biomarker, re, brands] of c.fda || []) {
      const bioRe = new RegExp(re, "i");
      const drugs = [];
      for (const brand of brands) {
        const l = await label(brand); if (!l) continue;
        const ind = (l.indications_and_usage || []).join(" ");
        const ex = sameIndication(ind, bioRe, cancerRe);
        if (!ex) continue;
        drugs.push({ brand: (l.openfda?.brand_name || [brand])[0], generic: (l.openfda?.generic_name || [""])[0].toLowerCase(),
          setId: l.set_id, labelDate: l.effective_time, url: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${l.set_id}`,
          excerpt: ex.replace(/\s+/g, " ").slice(0, 320), source: "openfda", retrieved: TODAY });
      }
      if (drugs.length) e.therapies.push({ biomarker, drugs, trials: await ctCount(c.ct, biomarker.split(/[ /(]/)[0]) });
    }
    // Genes that show up in this cancer's published data: trial counts for the top few.
    const topGenes = [...new Set(e.genomics.flatMap((g) => g.genes.slice(0, 4).map((x) => x.gene)))].slice(0, 6);
    e.geneTrials = {};
    for (const g of topGenes) { const t = await ctCount(c.ct, g); if (t) e.geneTrials[g] = t; }
    e.patientBranches = { shared: 0, note: "Patient-shared branches start at zero. Nobody has shared on this tree yet." };
    cancers.push(e);
  }
  const data = { generated: TODAY, about: "Published, aggregate figures only. No patient records. Each figure lists its source, licence and retrieval date.",
    sources: SOURCES, groups: GROUPS.map(([id, name]) => ({ id, name })), cancers };
  writeFileSync(OUT, JSON.stringify(data) + "\n");
  console.log(`\nwrote ${OUT.pathname}`);
}
main();
