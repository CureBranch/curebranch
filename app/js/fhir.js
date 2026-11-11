// Reads a FHIR R4 Bundle and pulls out ONLY the coarse facts the public summary
// can contain. Pure functions, no DOM, so they run in the browser and in Node tests.
// Codes follow mCODE (HL7 Minimal Common Oncology Data Elements) where possible.
// Nothing here decides anything for the patient: it suggests, the patient edits.

export const LOINC = "http://loinc.org";
export const SNOMED = "http://snomed.info/sct";
export const ICD10 = ["http://hl7.org/fhir/sid/icd-10-cm", "http://hl7.org/fhir/sid/icd-10"];
export const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm";

const L = {
  geneStudied: "48018-6",
  aminoAcidChange: "48005-3",
  dnaChange: "48004-6",
  variantAssessment: "69548-6",
  diseaseStatus: "97509-4", // mCODE CancerDiseaseStatus
  responseLegacy: "88040-1",
  stageClinical: "21908-9",
  stagePath: "21902-2",
  tmb: "94076-7",
};

// Coarse cancer type from ICD-10 prefix. Extend freely; this is a lookup table, not advice.
const ICD10_TYPES = [
  [/^C34/, "Lung"], [/^C1[89]|^C20/, "Colorectal"], [/^C43/, "Melanoma"], [/^C50/, "Breast"],
  [/^C61/, "Prostate"], [/^C25/, "Pancreas"], [/^C56/, "Ovary"], [/^C16/, "Stomach"],
  [/^C22/, "Liver"], [/^C64/, "Kidney"], [/^C67/, "Bladder"], [/^C71/, "Brain"],
  [/^C8[1-8]/, "Lymphoma"], [/^C9[1-5]/, "Leukemia"], [/^C90/, "Myeloma"],
];
const SNOMED_TYPES = {
  "254637007": "Lung", "363358000": "Lung", "93761005": "Colorectal", "363406005": "Colorectal",
  "372244006": "Melanoma", "254837009": "Breast", "399068003": "Prostate", "363418001": "Pancreas",
};
const TEXT_TYPES = [
  [/lung|nsclc|sclc/i, "Lung"], [/colo|rect/i, "Colorectal"], [/melanoma/i, "Melanoma"],
  [/breast/i, "Breast"], [/prostat/i, "Prostate"], [/pancrea/i, "Pancreas"], [/ovar/i, "Ovary"],
  [/lymphoma/i, "Lymphoma"], [/leuk/i, "Leukemia"], [/myeloma/i, "Myeloma"], [/glioma|glioblastoma|brain/i, "Brain"],
];

// Genes listed first become the second level of the suggested branch. Order is only a
// display convention for the default suggestion; the patient can change the branch.
export const DRIVER_GENES = ["KRAS", "EGFR", "BRAF", "ALK", "ROS1", "ERBB2", "HER2", "MET", "RET",
  "NTRK1", "NTRK2", "NTRK3", "NRAS", "PIK3CA", "BRCA1", "BRCA2", "IDH1", "IDH2", "FGFR2", "FGFR3", "KIT"];
const BIOMARKERS = [[/pd-?l1/i, "PD-L1"], [/tumor mutation(al)? burden|\btmb\b|mutations\/megabase/i, "TMB"],
  [/microsatellite|\bmsi\b/i, "MSI"], [/\bher2\b|erbb2/i, "HER2"], [/estrogen receptor|\ber\b/i, "ER"],
  [/progesterone receptor|\bpr\b/i, "PR"]];

const STATUS_SNOMED = {
  "268910001": "improving", "359746009": "stable", "271299001": "worsening",
  "260415000": "no-evidence-of-disease", "709137006": "not-determined",
};

const AA3 = { Ala: "A", Arg: "R", Asn: "N", Asp: "D", Cys: "C", Gln: "Q", Glu: "E", Gly: "G", His: "H", Ile: "I",
  Leu: "L", Lys: "K", Met: "M", Phe: "F", Pro: "P", Ser: "S", Thr: "T", Trp: "W", Tyr: "Y", Val: "V", Ter: "*" };

function codings(cc) { return (cc && cc.coding) || []; }
function hasCode(cc, system, code) { return codings(cc).some((c) => c.system === system && c.code === code); }
function ccText(cc) {
  if (!cc) return "";
  return cc.text || (codings(cc).find((c) => c.display) || {}).display || (codings(cc)[0] || {}).code || "";
}
function resources(bundle, type) {
  return ((bundle && bundle.entry) || []).map((e) => e.resource).filter((r) => r && r.resourceType === type);
}
function whenOf(r) {
  return r.effectiveDateTime || (r.effectivePeriod && r.effectivePeriod.start) || r.authoredOn ||
    r.performedDateTime || (r.performedPeriod && r.performedPeriod.start) || r.issued || null;
}

/** Shorten protein HGVS: "p.Gly12Cys" -> "G12C", "p.(Arg273His)" -> "R273H". */
export function shortProteinChange(s) {
  if (!s) return "";
  let t = String(s).trim().replace(/^.*?p\./, "").replace(/[()]/g, "");
  t = t.replace(/(Ala|Arg|Asn|Asp|Cys|Gln|Glu|Gly|His|Ile|Leu|Lys|Met|Phe|Pro|Ser|Thr|Trp|Tyr|Val|Ter)/g, (m) => AA3[m]);
  return t.slice(0, 40);
}

export function cancerTypeOf(cond) {
  for (const c of codings(cond.code)) {
    if (ICD10.includes(c.system)) {
      const hit = ICD10_TYPES.find(([re]) => re.test(c.code || ""));
      if (hit) return { label: hit[1], coding: { system: c.system, code: c.code, display: c.display || hit[1] } };
    }
    if (c.system === SNOMED && SNOMED_TYPES[c.code]) {
      return { label: SNOMED_TYPES[c.code], coding: { system: c.system, code: c.code, display: c.display || SNOMED_TYPES[c.code] } };
    }
  }
  const text = ccText(cond.code);
  const hit = TEXT_TYPES.find(([re]) => re.test(text));
  return hit ? { label: hit[1], coding: { display: text.slice(0, 120) } } : null;
}

function stageFrom(text) {
  const m = /\b(?:stage\s*)?(IV|III|II|I|0)(?:[ABC]\d?)?\b/i.exec(text || "");
  return m ? m[1].toUpperCase() : null;
}

/** Exact age in whole years (shared only at the Detailed or Full level). */
export function ageYears(birthDate, on = new Date()) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b)) return null;
  let age = on.getFullYear() - b.getFullYear();
  const md = on.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && on.getDate() < b.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

export function ageBand(birthDate, on = new Date()) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b)) return null;
  let age = on.getFullYear() - b.getFullYear();
  const md = on.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && on.getDate() < b.getDate())) age--;
  if (age < 0) return null;
  if (age >= 90) return "90+";
  const lo = Math.floor(age / 10) * 10;
  return `${lo}-${lo + 9}`;
}

const INTERP = { H: "high", HH: "high", L: "low", LL: "low", N: "normal", POS: "positive", NEG: "negative", DET: "detected", ND: "not detected" };
function levelOf(obs) {
  for (const cc of obs.interpretation || []) {
    for (const c of codings(cc)) if (INTERP[c.code]) return INTERP[c.code];
    if (ccText(cc)) return ccText(cc).toLowerCase().slice(0, 40);
  }
  if (obs.valueCodeableConcept) return ccText(obs.valueCodeableConcept).toLowerCase().slice(0, 40);
  if (obs.valueString) return obs.valueString.slice(0, 40);
  if (obs.valueQuantity) return `${obs.valueQuantity.value} ${obs.valueQuantity.unit || ""}`.trim().slice(0, 40);
  return "";
}

/**
 * Extract coarse facts from one or more FHIR Bundles.
 * Returns { cancerType, stageGroup, ageBand, markers, treatments, outcomes, counts }.
 */
export function extractFacts(bundles, { on = new Date() } = {}) {
  const list = Array.isArray(bundles) ? bundles : [bundles];
  const all = (type) => list.flatMap((b) => resources(b, type));

  const patient = all("Patient")[0];
  const conditions = all("Condition");
  let cancer = null, stage = null, stageText = null, diagnosisDate = null;
  for (const c of conditions) {
    const t = cancerTypeOf(c);
    if (t && !cancer) { cancer = t; diagnosisDate = (c.onsetDateTime || (c.onsetPeriod && c.onsetPeriod.start) || c.recordedDate || "").slice(0, 10) || null; }
    for (const s of c.stage || []) { stage = stage || stageFrom(ccText(s.summary)); stageText = stageText || ccText(s.summary) || null; }
  }

  const obs = all("Observation");
  const markers = [];
  const seen = new Set();
  const addMarker = (m) => {
    const k = `${m.gene}|${m.kind}|${m.change || ""}`;
    if (!seen.has(k)) { seen.add(k); markers.push(m); }
  };
  const outcomesRaw = [];
  for (const o of obs) {
    if (o.status === "entered-in-error" || o.status === "cancelled") continue;
    const comps = o.component || [];
    const geneComp = comps.find((c) => hasCode(c.code, LOINC, L.geneStudied));
    const codeText = ccText(o.code);
    const isRna = /\brna\b|expression|transcript/i.test(codeText) || codings(o.method).some((c) => /rna/i.test(c.display || ""));
    if (geneComp) {
      const gene = (ccText(geneComp.valueCodeableConcept) || geneComp.valueString || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 20);
      const aa = comps.find((c) => hasCode(c.code, LOINC, L.aminoAcidChange));
      const change = aa ? shortProteinChange(ccText(aa.valueCodeableConcept) || aa.valueString) : levelOf(o);
      if (gene) addMarker({ gene, kind: isRna ? "rna-expression" : "dna-variant", change: change || undefined, source: isRna ? "rna" : "dna" });
      continue;
    }
    if (hasCode(o.code, LOINC, L.stageClinical) || hasCode(o.code, LOINC, L.stagePath) || /stage group/i.test(codeText)) {
      stage = stage || stageFrom(ccText(o.valueCodeableConcept) || o.valueString);
      stageText = stageText || ccText(o.valueCodeableConcept) || o.valueString || null;
      continue;
    }
    if (hasCode(o.code, LOINC, L.diseaseStatus) || hasCode(o.code, LOINC, L.responseLegacy) || /disease status|response to/i.test(codeText)) {
      const v = codings(o.valueCodeableConcept).find((c) => c.system === SNOMED && STATUS_SNOMED[c.code]);
      let status = v ? STATUS_SNOMED[v.code] : null;
      if (!status) {
        const t = ccText(o.valueCodeableConcept) + " " + (o.valueString || "");
        status = /no evidence|remission|not detected/i.test(t) ? "no-evidence-of-disease"
          : /improv|partial|complete|shrink/i.test(t) ? "improving"
          : /stable/i.test(t) ? "stable"
          : /worse|progress/i.test(t) ? "worsening" : "not-determined";
      }
      outcomesRaw.push({ status, when: whenOf(o) });
      continue;
    }
    const bm = hasCode(o.code, LOINC, L.tmb) ? [null, "TMB"] : BIOMARKERS.find(([re]) => re.test(codeText));
    if (bm) addMarker({ gene: bm[1], kind: "biomarker", change: levelOf(o) || undefined, source: /ihc|immunohisto|stain/i.test(codeText) ? "ihc" : "other" });
  }

  // Treatments: medicines only (procedures are an open choice, see docs).
  const meds = [...all("MedicationStatement"), ...all("MedicationRequest"), ...all("MedicationAdministration")];
  const byName = new Map();
  for (const m of meds) {
    if (["entered-in-error", "cancelled"].includes(m.status)) continue;
    const cc = m.medicationCodeableConcept;
    const name = ccText(cc).slice(0, 80);
    if (!name) continue;
    const rx = codings(cc).find((c) => c.system === RXNORM);
    const when = whenOf(m);
    const prev = byName.get(name.toLowerCase());
    if (!prev || (when && (!prev.when || when < prev.when))) {
      const end = (m.effectivePeriod && m.effectivePeriod.end) || null;
      const dosage = ((m.dosage || m.dosageInstruction || [])[0] || {}).text || undefined;
      byName.set(name.toLowerCase(), { name, rxnorm: rx ? rx.code : undefined, when, end, status: m.status, dosage });
    }
  }
  const tAll = [...byName.values()].sort((a, b) => String(a.when || "").localeCompare(String(b.when || "")));
  const treatments = tAll.map((t) => ({ name: t.name, rxnorm: t.rxnorm, startYear: t.when ? Number(t.when.slice(0, 4)) : undefined }));

  const firstStart = tAll.find((t) => t.when);
  const day = (d) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : undefined);
  const addr = patient && (patient.address || [])[0];
  const outcomes = outcomesRaw
    .sort((a, b) => String(a.when || "").localeCompare(String(b.when || "")))
    .map((o) => {
      const out = { status: o.status, date: day(o.when) };
      if (o.when && firstStart) {
        const months = Math.round((new Date(o.when) - new Date(firstStart.when)) / (30.44 * 864e5));
        if (months >= 0) out.monthsFromStart = months;
        let idx = -1;
        tAll.forEach((t, i) => { if (t.when && t.when <= o.when) idx = i; });
        if (idx >= 0) out.afterTreatment = idx;
      }
      return out;
    });

  return {
    cancerType: cancer,
    stageGroup: stage,
    ageBand: patient ? ageBand(patient.birthDate, on) : null,
    markers,
    treatments: treatments.map((t) => JSON.parse(JSON.stringify(t))),
    outcomes,
    // Extra detail, published only if the patient picks the Detailed or Full level.
    detail: JSON.parse(JSON.stringify({
      age: patient ? ageYears(patient.birthDate, on) : null,
      stageText: stageText ? String(stageText).slice(0, 40) : undefined,
      diagnosisDate: day(diagnosisDate),
      // City / state / country only. Street, postal code and other address lines are never extracted.
      location: addr ? { city: addr.city, state: addr.state, country: addr.country } : undefined,
      treatments: tAll.map((t) => ({ name: t.name, startDate: day(t.when), endDate: day(t.end), status: t.status, dosage: t.dosage ? String(t.dosage).slice(0, 200) : undefined })),
    })),
    counts: { patients: all("Patient").length, conditions: conditions.length, observations: obs.length, medications: meds.length },
  };
}

/** Default branch suggestion: [cancer type, first driver gene found, its change]. */
export function suggestBranch(facts) {
  const path = [facts.cancerType ? facts.cancerType.label : "Unknown type"];
  const variants = facts.markers.filter((m) => m.kind === "dna-variant");
  let driver = null;
  for (const g of DRIVER_GENES) {
    driver = variants.find((m) => m.gene.toUpperCase() === g);
    if (driver) break;
  }
  if (driver) {
    path.push(driver.gene.toUpperCase());
    if (driver.change) path.push(driver.change);
  }
  return path;
}
