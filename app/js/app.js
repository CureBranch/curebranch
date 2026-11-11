// CureBranch app: wires the screens to the on-device record. No server calls except
// (a) fetching this site's own example files and (b) fetching a SMART Health Card
// issuer's public keys, and (c) a hospital portal the PATIENT chooses to connect.
import { CONFIG } from "./config.js";
import { getOrCreateRecord, saveRecord, ownerKeys, ownerPublicJwk, backupBlob, deleteEverything, getFile, deleteFile } from "./store.js";
import { extractJwsList, verifyHealthCard } from "./shc.js";
import { extractFacts, suggestBranch } from "./fhir.js";
import { buildSummary, signSummary, DEFAULT_SHARE } from "./summary.js";
import { livingTreeSvg, parsePathKey } from "./living-tree.js";
import { newStewardKey, stewardKeyHash, todayISO } from "./codes.js";
import { startSmartConnect, finishSmartConnectIfReturning } from "./smart.js";
import { initPwa, pushOptIn, pushOptOut } from "./pwa.js";
import { AFTER_WORDS, needsOnboarding, shouldResumeOnboarding, chooseAfterDeath, removeSource } from "./onboarding.js";
import { initWizard, openWizard, refreshWizard } from "./wizard.js";
import { matchWords } from "./consistency.js";
import { setPrivacyLevel, statusWords, levelName, isPublicLevel, privacyLevel } from "./privacy.js";
import { mountPrivacyPicker, refreshPickers } from "./privacy-ui.js";
import { noteFirstShare } from "./recognition.js";
import { loadPublicData, cancerById, publicTreeRoot, exploreListHtml, navHtml, wireNav, markCurrent, cancerPageHtml, sourcesPageHtml, branchPublicHtml } from "./public-data.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATUS_WORDS = { "no-evidence-of-disease": "no sign of cancer", improving: "improving", stable: "stable", worsening: "worse", "not-determined": "unclear", "not-reported": "not reported" };
const AFTER = AFTER_WORDS;
const afterWords = (r) => (r.onboarding && r.onboarding.afterDeathChosen ? AFTER[r.afterDeath.choice] : "Not chosen yet");
const SHARE_LABELS = { cancerType: "Cancer type", stageGroup: "Stage (e.g. III)", ageBand: "Age range (e.g. 60-69)", markers: "Tumor markers (DNA and RNA)", treatments: "Treatments and the year started", outcomes: "How it went", publicContact: "My public contact handle", profile: "My name and photo (profile page)" };

let record = null;
let pickedPath = null; // branch picked on the tree picture (this visit only)
let toastTimer;

export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function profileUrl(code) { return CONFIG.PUBLIC_BASE + code; }
function localProfileHref(code) { return `/profile.html?c=${encodeURIComponent(code)}`; }
function download(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------- navigation ----------
const TITLES = { home: "Home", import: "Import", repo: "My record", tree: "The tree", settings: "Settings", start: "How it works", a11y: "Accessibility", cancer: "Cancer tree", sources: "Sources and licenses" };
let currentCancer = null;
function go(route, focusId) {
  let [name, ...rest] = String(route || "").split("/");
  let hash = name;
  if (name === "cancer") {
    const c = cancerById(rest[0]);
    if (!c) name = "tree";
    else {
      currentCancer = c;
      $("#cancer-body").innerHTML = cancerPageHtml(c);
      hash = `cancer/${c.id}`;
      if (rest[1] && !focusId) focusId = rest[1];
    }
  }
  if (name === "sources") $("#sources-body").innerHTML = sourcesPageHtml();
  if (!TITLES[name]) name = hash = "home";
  closeNav(false);
  markCurrent($("#cancer-nav"), name === "cancer" ? currentCancer.id : null);
  if (window.CureBranchA11y) CureBranchA11y.stopSpeech();
  $$(".screen").forEach((s) => s.classList.toggle("active", s.id === "s-" + name));
  const tabFor = { start: "home", a11y: "settings" }[name] || name;
  $$("#tabs button").forEach((b) => {
    const on = b.dataset.go === tabFor;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  document.title = `CureBranch: ${name === "cancer" ? currentCancer.name : TITLES[name]}`;
  window.scrollTo(0, 0);
  if (location.hash !== "#" + hash) history.replaceState(null, "", "#" + hash);
  const target = focusId ? document.getElementById(focusId) : $("#s-" + name + " h1");
  if (target) {
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: !focusId });
    if (focusId) target.scrollIntoView({ block: "center" });
    const det = target.closest("details"); if (det) det.open = true;
  }
  render(true);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (!b || b.disabled) return;
  e.preventDefault();
  go(b.dataset.go, b.dataset.focus);
});

// ---------- cancer-tree navigation: left column on wide screens, a drawer on phones ----------
const wideNav = () => window.matchMedia("(min-width: 1024px)").matches;
function openNav() {
  const nav = $("#sidenav"); if (!nav || wideNav()) return;
  nav.classList.add("open");
  nav.setAttribute("role", "dialog"); nav.setAttribute("aria-modal", "true");
  $("#nav-backdrop").hidden = false;
  $("#nav-toggle").setAttribute("aria-expanded", "true");
  ["#screens", "#tabs", ".topbar"].forEach((q) => { const el = $(q); if (el) el.inert = true; });
  document.documentElement.classList.add("nav-open");
  $("#nav-search").focus();
}
function closeNav(returnFocus = true) {
  const nav = $("#sidenav"); if (!nav || !nav.classList.contains("open")) return;
  nav.classList.remove("open"); nav.removeAttribute("role"); nav.removeAttribute("aria-modal");
  $("#nav-backdrop").hidden = true;
  $("#nav-toggle").setAttribute("aria-expanded", "false");
  ["#screens", "#tabs", ".topbar"].forEach((q) => { const el = $(q); if (el) el.inert = false; });
  document.documentElement.classList.remove("nav-open");
  if (returnFocus) $("#nav-toggle").focus();
}
function initNav() {
  const setH = () => document.documentElement.style.setProperty("--chrome-h", `${$(".chrome").offsetHeight}px`);
  setH(); new ResizeObserver(setH).observe($(".chrome"));
  const host = $("#cancer-nav");
  host.innerHTML = navHtml();
  wireNav(host);
  $("#nav-toggle").addEventListener("click", () => ($("#sidenav").classList.contains("open") ? closeNav() : openNav()));
  $("#nav-close").addEventListener("click", () => closeNav());
  $("#nav-backdrop").addEventListener("click", () => closeNav());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#sidenav").classList.contains("open")) { e.preventDefault(); closeNav(); } });
  window.matchMedia("(min-width: 1024px)").addEventListener("change", () => closeNav(false));
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-open-wizard]");
  if (b) { e.preventDefault(); openWizard({ restart: !needsOnboarding(record) }); }
});

// ---------- rendering ----------
function facts() { return extractFacts(record.sources.map((s) => s.bundle)); }
function branchPath() {
  return record.branchPath && record.branchPath.length ? record.branchPath : (record.sources.length ? suggestBranch(facts()) : null);
}

function statusLine(st) {
  return Object.entries(st.status).map(([k, v]) => `${v} ${STATUS_WORDS[k] || k}`).join(" · ");
}

function renderHome() {
  const hello = $("#home-hello");
  if (hello) hello.textContent = (() => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; })();
  const startBtn = $("#home-start-branch");
  if (startBtn) {
    const done = !!(record.onboarding && record.onboarding.completedAt);
    const started = !!(record.onboarding && (record.onboarding.startedAt || record.onboarding.step));
    startBtn.hidden = done;
    const steps = $("#home-steps");
    if (steps) steps.hidden = done;
    if (!done) startBtn.textContent = started ? "Continue your branch" : "Create your branch";
  }
  const addr = $("#my-address");
  addr.textContent = profileUrl(record.code).replace(/^https:\/\//, "");
  addr.href = localProfileHref(record.code);
  const path = branchPath();
  $("#home-branch").innerHTML = path
    ? `<h2>Your branch</h2><p class="sub" style="margin:0 0 8px">${esc(path.join(" › "))}</p>
       ${(facts().markers || []).slice(0, 6).map((m) => `<span class="chip">${esc(m.gene)}${m.change ? " " + esc(m.change) : ""}</span>`).join("")}
       <button type="button" class="btn btn-primary" data-go="tree" style="margin-top:8px">View my branch</button>`
    : `<h2>Find your branch</h2><p class="sub">Import your records to see where you sit on the tree. You can try it with example records first.</p>
       <button type="button" class="btn btn-primary" data-go="import">Import records</button>`;
  $("#home-worked").innerHTML = branchPublicHtml(path || ["Lung"]);
  $("#after-status").textContent = afterWords(record);
}

function renderPrivacy() {
  const st = statusWords(record);
  $("#privacy-title").textContent = st.title;
  $("#privacy-help").textContent = st.help;
  refreshPickers();
  refreshWizard();
}

function renderRepo() {
  $("#repo-code").textContent = record.code;
  $("#sources").innerHTML = record.sources.length
    ? record.sources.map((s) => `<div class="item"><div class="dot ${s.verification.status === "verified" ? "g" : ""}" aria-hidden="true">${s.verification.status === "verified" ? "✓" : "!"}</div>
        <div class="grow"><h3>${esc(s.fileName || s.kind)}</h3><small>${s.verification.status === "verified" ? "Verified" : "Unverified"} · ${esc(s.verification.detail || s.verification.method)}</small>
        <button type="button" class="link" data-remove-source="${esc(s.id)}" style="background:none;border:0;padding:0;cursor:pointer;font:inherit">Remove this record</button></div></div>`).join("")
    : `<p class="sub" style="margin:0">No records yet. <a class="link" href="#import" data-go="import">Import records</a></p>`;
  const files = record.files || [];
  $("#files-list").innerHTML = files.length
    ? files.map((f) => `<div class="item"><div class="dot" aria-hidden="true">${f.kind === "photo" ? "▣" : "▤"}</div>
        <div class="grow"><h3>${esc(f.name)}</h3><small><span class="chip amber">Supporting, from patient</span> ${f.kind === "photo" ? "Photo" : "File"} for ${esc((record.sources.find((x) => x.id === f.linkedSourceId) || {}).fileName || "a record")} · kept on this device · not counted</small>
        <p class="notice ${f.matchStatus === "mismatch" ? "err" : f.matchStatus === "matches" ? "ok" : ""}" style="margin:6px 0">${esc(matchWords(f))}${(f.mismatchReasons || []).map((x) => " " + esc(x)).join("")}</p>
        <div class="row" style="gap:16px"><button type="button" class="link" data-open-file="${esc(f.id)}" style="background:none;border:0;padding:0;cursor:pointer;font:inherit">Save a copy</button>
        <button type="button" class="link" data-remove-file="${esc(f.id)}" style="background:none;border:0;padding:0;cursor:pointer;font:inherit">Remove</button></div></div></div>`).join("")
    : `<p class="sub" style="margin:0">None yet. You can add a supporting photo or file to a record from your hospital in the setup guide (Settings, then Run the setup guide again).</p>`;
  const f = facts();
  $("#facts").innerHTML = record.sources.length ? `
    <p style="margin:0 0 6px"><strong>Cancer type:</strong> ${esc(f.cancerType ? f.cancerType.label : "not found")}${f.stageGroup ? ` · <strong>Stage:</strong> ${esc(f.stageGroup)}` : ""}${f.ageBand ? ` · <strong>Age range:</strong> ${esc(f.ageBand)}` : ""}</p>
    <p style="margin:0 0 6px"><strong>Markers:</strong></p><p>${f.markers.map((m) => `<span class="chip ${m.kind === "rna-expression" ? "sky" : m.kind === "biomarker" ? "amber" : ""}">${esc(m.gene)}${m.change ? " " + esc(m.change) : ""}</span>`).join("") || "none found"}</p>
    <p style="margin:0 0 6px"><strong>Treatments:</strong> ${esc(f.treatments.map((t) => t.name + (t.startYear ? ` (${t.startYear})` : "")).join(", ") || "none found")}</p>
    <p style="margin:0"><strong>How it went:</strong> ${esc(f.outcomes.map((o) => STATUS_WORDS[o.status]).join(", ") || "none found")}</p>
    <p class="sub" style="margin:8px 0 0">Read by simple matching rules, not by AI. If something is wrong, fix it at the source or change your branch below.</p>` : `<p class="sub" style="margin:0">Nothing yet.</p>`;
  const path = branchPath();
  if (document.activeElement !== $("#branch-in")) $("#branch-in").value = path ? path.join(" › ") : "";
  $("#branch-how").textContent = !path ? "Import records first, or type your own branch."
    : record.branchPath ? "You set this branch yourself." : "Suggested from your records: cancer type, then the first known driver gene. Change it if you like.";
  const share = { ...DEFAULT_SHARE, ...record.share };
  $("#share-list").innerHTML = `<legend class="sr-only">Parts of the public summary</legend>` + Object.keys(SHARE_LABELS).map((k) =>
    `<label><input type="checkbox" data-share="${k}" ${share[k] ? "checked" : ""}> ${esc(SHARE_LABELS[k])}</label>`).join("");
  renderSummary();
}

async function currentSummary() {
  const s = buildSummary(record, await ownerPublicJwk());
  return signSummary(s, (await ownerKeys()).privateKey);
}
async function renderSummary() {
  const s = await currentSummary();
  $("#summary-json").textContent = JSON.stringify(s, null, 2);
  $("#summary-state").textContent = s.visibility === "public"
    ? `Public. This is everything that would be shared, at ${profileUrl(record.code)}. It is signed with a key that stays on this device.`
    : "Private. If shared, this would only ask for your code to be removed. Pick a public sharing level in Settings to see the full summary.";
}

function renderTree() {
  $("#tree-list").innerHTML = exploreListHtml();
  const mine = branchPath();
  $("#living-tree").innerHTML = livingTreeSvg(publicTreeRoot(), {
    mine, selected: pickedPath, interactive: true, idPrefix: "lt-main",
    words: (h) => `${h.path.join(", then ")}. ${h.tip && h.path.length > 1 ? "Gene often mutated in this cancer. " : ""}0 patients have shared here so far.`,
    label: `The tree, drawn as a living tree. Each big limb is a cancer type, sized by new cases a year, and each leafy tip is a gene often mutated in it.${mine ? ` Your branch, ${mine.join(", then ")}, has a golden flower.` : ""} Pick a limb or a tip to see published data for it.`,
  });
  renderBranchPanel();
}

function renderBranchPanel() {
  const mine = branchPath();
  const path = pickedPath || mine || ["Lung"];
  const title = pickedPath ? "Branch you picked" : mine ? "My branch" : "Published data: Lung";
  $("#panel-branch").innerHTML = `<h2>${title}</h2><p class="sub">${esc(path.join(" › "))}</p>${branchPublicHtml(path)}`;
  $("#lt-caption").textContent = pickedPath ? `Showing ${pickedPath.join(" › ")} below.` : "Tap or pick a limb or a leafy tip to see that branch below.";
}

function pickTreeBranch(el) {
  const p = parsePathKey(el.dataset.ltPath);
  pickedPath = p.length ? p : null;
  $$("#living-tree .lt-hit").forEach((h) => { const on = h === el; h.classList.toggle("lt-selected", on); h.setAttribute("aria-pressed", String(on)); });
  const branchTab = $("#tab-branch");
  if (branchTab.getAttribute("aria-selected") !== "true") branchTab.click();
  renderBranchPanel();
}

function renderSettings(fillInputs) {
  $$('input[name="afterdeath"]').forEach((r) => { r.checked = !!(record.onboarding && record.onboarding.afterDeathChosen) && r.value === record.afterDeath.choice; });
  const p = record.afterDeath.person || {};
  // Text fields are only filled when the screen is opened, so a re-render never wipes what someone is typing.
  if (fillInputs) {
    $("#steward-name").value = p.name || "";
    $("#steward-reach").value = p.howToReach || "";
    $("#prof-name").value = (record.profile && record.profile.displayName) || "";
    $("#prof-alt").value = (record.profile && record.profile.photo && record.profile.photo.alt) || "";
    $("#contact-in").value = record.publicContact || "";
    $("#ai-name").value = (record.ai && record.ai.name) || "";
  }
  if (record.afterDeath.stewardKeyHash && !$("#steward-out").dataset.fresh) {
    $("#steward-out").innerHTML = `<p class="notice ok">A key was made on ${esc(record.afterDeath.stewardKeyGivenOn || "an earlier date")}. Making a new one replaces it.</p>`;
  }
  const link = $("#profile-link");
  link.textContent = profileUrl(record.code).replace(/^https:\/\//, "");
  link.href = localProfileHref(record.code);
  $("#recognition-link").href = localProfileHref(record.code) + "#recognition";
  $("#profile-switch").setAttribute("aria-checked", String(!!record.share.profile));
  const ph = record.profile && record.profile.photo;
  $("#prof-preview").innerHTML = ph ? `<img src="data:${esc(ph.mediaType)};base64,${ph.data}" alt="${esc(ph.alt || "Your profile photo")}" style="max-width:160px;width:100%;border-radius:16px;margin-top:10px">` : "";
  $("#push-switch").setAttribute("aria-checked", String(!!(record.notifications && record.notifications.pushOptIn)));
  $("#build-id").textContent = document.querySelector('meta[name="cb-build"]').content;
}

function render(entering) {
  if (!record) return;
  renderPrivacy();
  const active = ($(".screen.active") || {}).id;
  if (active === "s-home") renderHome();
  if (active === "s-repo") renderRepo();
  if (active === "s-tree") renderTree();
  if (active === "s-settings") renderSettings(!!entering);
}

// ---------- import ----------
let trustList = null;
async function getTrustList() {
  if (!trustList) trustList = (await (await fetch("/data/trusted-issuers.json")).json()).issuers;
  return trustList;
}

function showImport(kind, msg) {
  $("#import-result").innerHTML = `<div class="notice ${kind}" role="${kind === "err" ? "alert" : "status"}">${msg}</div>`;
}

async function addSource(src) {
  record.sources.push(src);
  if (src.example) record.example = true;
  noteFirstShare(record);
  await saveRecord(record, `Imported ${src.fileName || src.kind} (${src.verification.status})`);
  const f = facts();
  showImport(src.verification.status === "verified" ? "ok" : "",
    `<strong>${src.verification.status === "verified" ? "Imported and verified." : "Imported, but not verified."}</strong> ${esc(src.verification.detail)}
     <br>Found: ${esc(f.cancerType ? f.cancerType.label : "no cancer type")}, ${f.markers.length} markers, ${f.treatments.length} treatments.
     ${isPublicLevel(privacyLevel(record)) ? `Your sharing level is ${esc(levelName(privacyLevel(record)))}, so a summary of this is shared under your code.` : "Nothing has been shared."} <a class="link" href="#repo" data-go="repo">Review my record</a>`);
}

export async function importText(text, fileName) {
  const t = text.trim();
  let obj = null;
  if (t.startsWith("{")) { try { obj = JSON.parse(t); } catch { throw new Error("This file isn't valid JSON."); } }
  if (obj && obj.resourceType === "Bundle") {
    const isExample = JSON.stringify(obj.meta || {}).includes("EXAMPLE");
    return addSource({ id: crypto.randomUUID(), kind: "fhir-bundle-file", fileName, importedAt: new Date().toISOString(), example: isExample || undefined, origin: { connectedVia: "file-upload" },
      verification: { status: "unverified", method: "file-upload", detail: "Plain FHIR files have no hospital signature, so they are shown but not counted." }, bundle: obj });
  }
  const jwsList = extractJwsList(t);
  const trust = await getTrustList();
  for (const jws of jwsList) {
    const r = await verifyHealthCard(jws, { trustList: trust });
    await addSource({ id: crypto.randomUUID(), kind: "smart-health-card", fileName, importedAt: new Date().toISOString(), example: r.example || undefined, origin: { connectedVia: "smart-health-card" },
      verification: { ...r.verification }, bundle: r.bundle });
  }
}

async function handleImport(promise) {
  try { await promise; }
  catch (e) { showImport("err", `<strong>Could not import.</strong> ${esc(e.message)}`); }
}

// ---------- wiring ----------
function wire() {
  $("#file-in").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) handleImport(f.text().then((t) => importText(t, f.name)));
    e.target.value = "";
  });
  $("#shc-paste-go").addEventListener("click", () => handleImport(importText($("#shc-text").value, "Pasted health card")));
  $("#try-shc").addEventListener("click", () => handleImport(fetch("/data/examples/example-health-card.smart-health-card").then((r) => r.text()).then((t) => importText(t, "Example health card (EXAMPLE)"))));
  $("#try-fhir").addEventListener("click", () => handleImport(fetch("/data/examples/example-fhir-bundle.json").then((r) => r.text()).then((t) => importText(t, "Example FHIR file (EXAMPLE)"))));
  $("#smart-connect").addEventListener("click", () => {
    const res = startSmartConnect();
    if (res && res.notSetUp) showImport("", "<strong>Not set up yet.</strong> Connecting a hospital portal needs a free patient-app registration with the hospital's software maker (for example Epic). The site owner does this once; see docs/architecture.md.");
  });


  $$(".agree").forEach((c) => c.addEventListener("change", () => { $("#agree-next").disabled = !$$(".agree").every((x) => x.checked); }));

  document.addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-remove-source]");
    if (!rm) return;
    if (!confirm("Remove this record from this device?")) return;
    for (const fid of removeSource(record, rm.dataset.removeSource)) await deleteFile(fid);
    await saveRecord(record, "Removed a record");
    render();
  });
  document.addEventListener("click", async (e) => {
    const op = e.target.closest("[data-open-file]");
    const rm = e.target.closest("[data-remove-file]");
    if (op) {
      const meta = (record.files || []).find((f) => f.id === op.dataset.openFile);
      const blob = meta && await getFile(meta.id);
      if (blob) download(meta.name, blob); else toast("That file is no longer on this device.");
    }
    if (rm) {
      if (!confirm("Remove this photo or file from this device?")) return;
      await deleteFile(rm.dataset.removeFile);
      record.files = (record.files || []).filter((f) => f.id !== rm.dataset.removeFile);
      if (!record.files.length) delete record.files;
      await saveRecord(record, "Removed a photo or file");
      render();
    }
  });
  $("#rerun-wizard").addEventListener("click", () => openWizard({ restart: true }));
  const startBranch = $("#home-start-branch");
  if (startBranch) startBranch.addEventListener("click", () => openWizard());
  document.addEventListener("change", async (e) => {
    const cb = e.target.closest("[data-share]");
    if (!cb) return;
    record.share = { ...DEFAULT_SHARE, ...record.share, [cb.dataset.share]: cb.checked };
    await saveRecord(record, `${cb.checked ? "Included" : "Left out"}: ${SHARE_LABELS[cb.dataset.share]}`);
    renderSummary();
  });

  $("#branch-save").addEventListener("click", async () => {
    const parts = $("#branch-in").value.split(/›|>|,/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
    if (!parts.length) { toast("Type at least one level, like Lung."); return; }
    record.branchPath = parts; record.branchPlacedBy = "patient";
    await saveRecord(record, "Set branch by hand");
    toast("Branch saved."); render();
  });
  $("#branch-reset").addEventListener("click", async () => {
    delete record.branchPath; record.branchPlacedBy = "rules";
    await saveRecord(record, "Went back to the suggested branch"); render();
  });
  $("#dl-summary").addEventListener("click", async () => {
    download(`curebranch-summary-${record.code}.json`, new Blob([JSON.stringify(await currentSummary(), null, 2)], { type: "application/json" }));
  });
  $("#copy-ai").addEventListener("click", async () => {
    const s = await currentSummary();
    const prompt = `I'm using CureBranch, an open patient-owned cancer knowledge tree. Below is my minimal public summary (JSON). ` +
      `Please (1) check whether the branch path ${JSON.stringify(s.branch.path)} fits my markers, and (2) explain in plain English what the markers mean. ` +
      `This is for discussion with my doctors, not medical advice.\n\n${JSON.stringify(s, null, 2)}`;
    try { await navigator.clipboard.writeText(prompt); toast("Copied. Paste it into your own AI."); }
    catch { download("curebranch-ai-prompt.txt", new Blob([prompt], { type: "text/plain" })); }
  });

  $$('input[name="afterdeath"]').forEach((r) => r.addEventListener("change", async () => {
    chooseAfterDeath(record, r.value);
    await saveRecord(record, `After-death choice: ${AFTER[r.value]}`);
    toast("Saved."); render();
  }));
  $("#steward-save").addEventListener("click", async () => {
    record.afterDeath.person = { name: $("#steward-name").value.trim(), howToReach: $("#steward-reach").value.trim() };
    await saveRecord(record, "Updated the person who carries out my choice");
    toast("Saved on this device.");
  });
  $("#steward-key").addEventListener("click", async () => {
    const key = newStewardKey();
    record.afterDeath.stewardKeyHash = await stewardKeyHash(key);
    record.afterDeath.stewardKeyGivenOn = todayISO();
    await saveRecord(record, "Made a new key for my chosen person");
    const name = (record.afterDeath.person && record.afterDeath.person.name) || "the person you chose";
    const letter = `CureBranch: key for ${name}\n\nYou were chosen to carry out a CureBranch choice after the person who gave you this dies.\n` +
      `Their public code: ${record.code} (${profileUrl(record.code)})\nTheir choice: ${AFTER[record.afterDeath.choice]}\n` +
      `Your key (keep it private): ${key}\n\nWith this key you can ask for their public summary to be kept or removed. ` +
      `Nobody else can see this key; only a scrambled version of it is published.\n`;
    const out = $("#steward-out");
    out.dataset.fresh = "1";
    out.innerHTML = `<div class="notice ok"><p style="margin:0 0 6px"><strong>Give this key to ${esc(name)}.</strong> It is shown only once.</p>
      <p class="mono" style="font-size:1.1rem;margin:0 0 8px">${esc(key)}</p><button type="button" class="btn btn-ghost" id="steward-letter">Download a letter for them</button></div>`;
    $("#steward-letter").addEventListener("click", () => download(`curebranch-key-letter-${record.code}.txt`, new Blob([letter], { type: "text/plain" })));
  });

  $("#profile-switch").addEventListener("click", async () => {
    record.share = { ...DEFAULT_SHARE, ...record.share, profile: !record.share.profile };
    await saveRecord(record, record.share.profile ? "Profile shown" : "Profile hidden (anonymous)");
    render();
  });
  $("#prof-photo").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      record.profile = { ...(record.profile || {}), photo: { ...(await resizePhoto(f)), alt: $("#prof-alt").value.trim() || undefined } };
      await saveRecord(record, "Added a profile photo");
      render();
    } catch { toast("That image couldn't be read."); }
  });
  $("#prof-save").addEventListener("click", async () => {
    const name = $("#prof-name").value.trim();
    record.profile = { ...(record.profile || {}) };
    if (name) record.profile.displayName = name; else delete record.profile.displayName;
    if (record.profile.photo) record.profile.photo.alt = $("#prof-alt").value.trim() || undefined;
    await saveRecord(record, "Updated profile");
    toast("Profile saved."); render();
  });
  $("#prof-clear").addEventListener("click", async () => {
    if (record.profile) delete record.profile.photo;
    await saveRecord(record, "Removed profile photo"); render();
  });
  $("#contact-save").addEventListener("click", async () => {
    record.publicContact = $("#contact-in").value.trim() || undefined;
    await saveRecord(record, "Updated public contact"); toast("Saved.");
  });
  $("#ai-save").addEventListener("click", async () => {
    record.ai = { name: $("#ai-name").value.trim() };
    await saveRecord(record, "Updated which AI I use"); toast("Saved.");
  });
  $("#push-switch").addEventListener("click", async () => {
    const on = !(record.notifications && record.notifications.pushOptIn);
    const out = $("#push-out");
    const res = on ? await pushOptIn() : await pushOptOut();
    out.innerHTML = `<p class="notice ${res.ok ? "ok" : ""}">${esc(res.message)}</p>`;
    record.notifications = { pushOptIn: on && res.ok };
    await saveRecord(record, record.notifications.pushOptIn ? "Turned on notifications" : "Turned off notifications");
    render();
  });
  $("#dl-backup").addEventListener("click", async () => download(`curebranch-backup-${record.code}.json`, await backupBlob()));
  $("#delete-all").addEventListener("click", async () => {
    if (!confirm("Delete your records, settings and signing key from this device? This can't be undone.")) return;
    await deleteEverything();
    record = await getOrCreateRecord();
    toast("Deleted. You have a fresh, empty record with a new code.");
    go("home");
    openWizard();
  });
  $("#open-a11y").addEventListener("click", () => window.CureBranchA11y && CureBranchA11y.openPanel());

  // Tree picture: limbs and tips are buttons (click, Enter or Space).
  const lt = $("#living-tree");
  lt.addEventListener("click", (e) => { const h = e.target.closest(".lt-hit"); if (h && h.dataset.ltPath) pickTreeBranch(h); });
  lt.addEventListener("keydown", (e) => {
    const h = e.target.closest(".lt-hit");
    if (!h || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault(); pickTreeBranch(h);
  });

  // Tree tabs (arrow keys move between tabs, per the ARIA tabs pattern)
  const tabs = $$("#s-tree [role=tab]");
  const selectTab = (t) => {
    tabs.forEach((x) => { const on = x === t; x.classList.toggle("on", on); x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; });
    $("#panel-branch").hidden = t.dataset.treeseg !== "branch";
    $("#panel-explore").hidden = t.dataset.treeseg !== "explore";
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => selectTab(t));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      n.focus(); selectTab(n);
    });
  });
}

/** Re-encode a photo on the device: max 512 px, JPEG. Re-encoding drops EXIF (GPS, camera). */
async function resizePhoto(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  let q = 0.85, url;
  do { url = c.toDataURL("image/jpeg", q); q -= 0.1; } while (url.length > 190000 && q > 0.3);
  return { mediaType: "image/jpeg", data: url.split(",")[1] };
}

async function main() {
  wire();
  record = await getOrCreateRecord();
  await loadPublicData();
  initNav();
  const returned = await finishSmartConnectIfReturning();
  if (returned) { await addSource(returned); }
  const start = decodeURIComponent(location.hash.replace("#", ""));
  go(TITLES[start.split("/")[0]] ? start : (returned ? "import" : "home"));
  if (returned) go("import");
  initPwa({ bannerHost: $("#banners") });
  $$("[data-privacy-picker]").forEach((el) => mountPrivacyPicker(el, {
    getRecord: () => record,
    apply: async (level) => {
      setPrivacyLevel(record, level);
      noteFirstShare(record);
      await saveRecord(record, `Sharing level: ${levelName(level)}`);
      toast(isPublicLevel(level) ? `Saved. Sharing at ${levelName(level)}.` : "Saved. Nothing new will be shared.");
      render();
    },
  }));
  initWizard({
    getRecord: () => record,
    save: (r, what) => saveRecord(r, what),
    addSource: (src) => addSource(src),
    onOpen: () => { const slot = $("#wz-banners"); if (slot) slot.appendChild($("#banners")); },
    onClose: ({ finished }) => {
      $(".chrome").after($("#banners"));
      go("home");
      if (finished) toast("All set. You can change any of this in Settings.");
      else toast("Saved. The guide will open where you left off next time.");
    },
  });
  window.CureBranchApp = { importText, go, getRecord: () => record, openWizard };
  const wantsSetup = new URLSearchParams(location.search).get("setup") === "1"; // "Start the easy setup guide" links
  if (wantsSetup) history.replaceState(null, "", location.pathname + location.hash);
  if (wantsSetup) await openWizard({ restart: !needsOnboarding(record) });
  else if (shouldResumeOnboarding(record)) await openWizard(); // resume after Finish later or a portal login
}
main();
