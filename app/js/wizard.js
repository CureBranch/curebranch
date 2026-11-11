// First-run setup guide (the "wizard"): full screen, 3 steps (Get started, Your records,
// Your choices), Back/Next, progress dots, a Listen button on every step. Every answer is
// saved on this device as soon as it is given, so the patient can close the app and pick
// up where they left off. It uses the app's own styles, so the Accessibility settings
// (text size, fonts, colors, motion) apply here too. Pure step logic lives in onboarding.js
// (unit-tested).
import { CONFIG } from "./config.js";
import { privacyLevel, highestShared } from "./privacy.js";
import { hasPending, cancelPending, refreshPickers } from "./privacy-ui.js";
import { randomCode } from "./codes.js";
import { putFile, deleteFile } from "./store.js";
import { startSmartConnect } from "./smart.js";
import { stubPortalImport } from "./portal-stub.js";
import { checkAttachment, matchWords, testNames } from "./consistency.js";
import {
  STEPS, STEP_IDS, AI_CHOICES, AFTER_WORDS, MAX_FILE_BYTES, PORTALS,
  setStep, completeStep, recordConsent, hasConsent, chooseAfterDeath, finishOnboarding,
  restartOnboarding, choicesSummary, resumeIndex, isOfficial, attachmentMeta, removeSource,
} from "./onboarding.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NO_AI = "I don't use an AI";

let api = null;   // { getRecord, save, addSource, onOpen, onClose }
let index = 0;
let busy = false;

const rec = () => api.getRecord();
const stepId = () => STEP_IDS[index];

function sizeWords(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}

// ---------- rendering ----------
function renderDots() {
  $("#wz-count").textContent = `Step ${index + 1} of ${STEPS.length}`;
  $("#wz-dots").innerHTML = STEPS.map((s, i) => {
    const state = i < index ? "done" : i === index ? "now" : "todo";
    const words = state === "done" ? "done" : state === "now" ? "you are here" : "not yet";
    return `<li class="${state}"${i === index ? ' aria-current="step"' : ""}><span class="wz-bar" aria-hidden="true"></span><span class="wz-lbl" aria-hidden="true">${esc(s.title)}</span><span class="sr-only">Step ${i + 1}, ${esc(s.title)}: ${words}</span></li>`;
  }).join("");
}

function renderVideo() {
  const box = $("#wz-video");
  if (!CONFIG.CONSENT_VIDEO_URL || box.dataset.ready) return;
  box.dataset.ready = "1";
  box.innerHTML = `<video class="wz-video-el" controls preload="metadata" playsinline src="${esc(CONFIG.CONSENT_VIDEO_URL)}">
    ${CONFIG.CONSENT_VIDEO_CAPTIONS ? `<track kind="captions" srclang="en" label="English" src="${esc(CONFIG.CONSENT_VIDEO_CAPTIONS)}" default>` : ""}
    Your browser can't play this video. Press Listen above to hear the main points.</video>`;
}

function sourceNote(src) {
  if (src.origin && src.origin.connectedVia === "demo-stub") return "EXAMPLE demo record (made up). Marked verified only to show how it works";
  if (isOfficial(src)) return "Verified: came from your hospital or lab";
  return "Not verified: kept, not counted";
}

function renderFiles() {
  const r = rec();
  const files = r.files || [];
  const items = r.sources.map((src) => {
    const att = files.filter((f) => f.linkedSourceId === src.id);
    const name = src.fileName || "Health record";
    return `<li class="wz-file-item"><div class="grow"><strong>${esc(name)}</strong><small>${esc(sourceNote(src))}</small></div>
      <button type="button" class="btn btn-ghost wz-remove" data-wz-remove="source:${esc(src.id)}" aria-label="Remove ${esc(name)}">Remove</button>
      ${isOfficial(src) ? `<label class="btn btn-ghost wz-file wz-attach"><span>Add a supporting photo or file</span>
        <input class="wz-file-input" type="file" accept="image/*,application/pdf,.pdf" data-attach-for="${esc(src.id)}" aria-label="Add a supporting photo or file to ${esc(name)}"></label>` : ""}
      ${att.length ? `<datalist id="wz-tests-${esc(src.id)}">${testNames(src.bundle).map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
      <ul class="wz-att">${att.map((f) => attachmentHtml(f, src)).join("")}</ul>` : ""}
    </li>`;
  });
  $("#wz-files").innerHTML = items.join("");
  $("#wz-files").hidden = !items.length;
  $("#wz-connected-h").hidden = !items.length;
  return items.length;
}

function attachmentHtml(f, src) {
  const c = f.claims || {};
  const flag = f.matchStatus === "mismatch" ? "err" : f.matchStatus === "matches" ? "ok" : "";
  const k = esc(f.id);
  return `<li data-file="${k}"><div class="grow"><strong>${esc(f.name)}</strong>
      <small><span class="chip amber">Supporting, from patient</span> ${f.kind === "photo" ? "Photo" : "File"}, ${sizeWords(f.size)}. Not counted</small></div>
    <button type="button" class="btn btn-ghost wz-remove" data-wz-remove="file:${k}" aria-label="Remove ${esc(f.name)}">Remove</button>
    <div class="wz-claim" role="group" aria-labelledby="wz-cl-h-${k}">
      <p class="wz-claim-h" id="wz-cl-h-${k}">What does this show? (optional) We'll check it matches your hospital record.</p>
      <label class="field-label" for="wz-cl-date-${k}">Date on it</label>
      <input class="field" type="date" id="wz-cl-date-${k}" value="${esc(c.date || "")}">
      <label class="field-label" for="wz-cl-type-${k}">Test type</label>
      <input class="field" type="text" id="wz-cl-type-${k}" list="wz-tests-${esc(src.id)}" maxlength="120" autocomplete="off" value="${esc(c.testType || "")}">
      <label class="field-label" for="wz-cl-vals-${k}">Key results, split by commas</label>
      <input class="field" type="text" id="wz-cl-vals-${k}" maxlength="400" autocomplete="off" aria-describedby="wz-cl-eg-${k}" value="${esc((c.keyValues || []).join(", "))}">
      <p class="wz-note" id="wz-cl-eg-${k}" style="margin:4px 0 8px">For example: KRAS G12C, PD-L1 70%</p>
      <button type="button" class="btn btn-ghost" data-wz-check="${k}">Check it</button>
      <div class="notice ${flag} wz-flag" id="wz-cl-flag-${k}" role="status"><strong>${esc(matchWords(f))}</strong>
        ${(f.mismatchReasons || []).length ? `<ul>${f.mismatchReasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>
    </div></li>`;
}

async function runCheck(fileId) {
  const r = rec();
  const f = checkAttachment(r, fileId, {
    date: $(`#wz-cl-date-${CSS.escape(fileId)}`).value,
    testType: $(`#wz-cl-type-${CSS.escape(fileId)}`).value,
    keyValues: $(`#wz-cl-vals-${CSS.escape(fileId)}`).value,
  });
  await save(`Checked a supporting file against the hospital record: ${f.matchStatus}`);
  renderFiles();
  const flag = $(`#wz-cl-flag-${CSS.escape(fileId)}`);
  if (flag) { flag.setAttribute("tabindex", "-1"); flag.focus(); }
}

function renderPortals() {
  const list = $("#wz-portal-list");
  if (!list.childElementCount) {
    list.innerHTML = PORTALS.map((p) => `<label class="wz-choice"><input type="radio" name="wz-portal" value="${esc(p.id)}"><span><strong>${esc(p.name)}</strong></span></label>`).join("");
  }
  const chosen = rec().onboarding && rec().onboarding.portal;
  $$('input[name="wz-portal"]').forEach((x) => { x.checked = x.value === chosen; });
  showConnect();
}
function portalPicked() { const x = $('input[name="wz-portal"]:checked'); return x ? x.value : ""; }
function showConnect() {
  const p = portalPicked();
  const real = !!CONFIG.SMART_CLIENT_ID;
  $("#wz-connect-card").hidden = !p;
  $("#wz-demo-note").hidden = real;
  const appleBlocked = real && p === "apple-health";
  $("#wz-apple-note").hidden = !appleBlocked;
  $("#wz-real-fields").hidden = !real || appleBlocked;
  $("#wz-connect").hidden = appleBlocked;
  $("#wz-connect").textContent = real ? "Connect" : "Connect (demo)";
}


function renderAi() {
  const r = rec();
  const current = r.ai && r.ai.name ? r.ai.name : "";
  const list = $("#wz-ai-list");
  if (!list.childElementCount) {
    list.innerHTML = AI_CHOICES.map((name, i) => `<label class="wz-choice wz-choice-sm"><input type="radio" name="wz-ai" value="${esc(name)}" id="wz-ai-${i}"><span><strong>${esc(name)}</strong></span></label>`).join("");
  }
  const known = AI_CHOICES.includes(current) ? current : (current ? "Another AI" : "");
  $$('input[name="wz-ai"]').forEach((x) => { x.checked = x.value === known; });
  showAiSteps();
}
function aiPicked() { const x = $('input[name="wz-ai"]:checked'); return x ? x.value : ""; }
function showAiSteps() {
  const v = aiPicked();
  $("#wz-ai-steps").hidden = !v || v === NO_AI;
  $("#wz-ai-name-inline").textContent = v && v !== "Another AI" && v !== NO_AI ? v : "your AI";
}

function renderSummary() {
  $("#wz-summary").innerHTML = choicesSummary(rec()).map((x) => `<div class="wz-sum-row"><dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd></div>`).join("");
}

function nextLabel() {
  const id = stepId();
  if (id === "choices") return "Go to my home screen";
  if (id === "records" && !privacyLevel(rec())) return "Skip for now (share nothing)";
  return "Next";
}
function updateNav() {
  $("#wz-back").hidden = index === 0;
  $("#wz-next").textContent = nextLabel();
  $("#wz-later").hidden = false;
}

function fillStep() {
  const r = rec();
  const id = stepId();
  if (id === "start") {
    renderVideo();
    $("#wz-consent").checked = hasConsent(r, CONFIG.CONSENT_VIDEO_VERSION);
    $("#wz-code").textContent = r.code;
    const locked = !!(highestShared(r) || r.afterDeath.stewardKeyHash);
    $("#wz-new-code").hidden = locked;
  }
  if (id === "records") { renderPortals(); renderFiles(); refreshPickers(); }
  if (id === "choices") {
    const chosen = r.onboarding && r.onboarding.afterDeathChosen;
    $$('input[name="wz-afterdeath"]').forEach((x) => { x.checked = !!chosen && x.value === r.afterDeath.choice; });
    const p = r.afterDeath.person || {};
    $("#wz-person").value = p.name || "";
    $("#wz-person-reach").value = p.howToReach || "";
    renderAi();
    renderSummary();
  }
  $$(".wz-err").forEach((e) => { e.textContent = ""; });
}

function show(i, { focus = true } = {}) {
  index = Math.max(0, Math.min(STEPS.length - 1, i));
  if (window.CureBranchA11y) CureBranchA11y.stopSpeech();
  $$("#wizard .wz-step").forEach((s) => { s.hidden = s.dataset.step !== stepId(); });
  renderDots();
  fillStep();
  updateNav();
  document.title = `CureBranch setup: ${STEPS[index].title}`;
  window.scrollTo(0, 0);
  if (focus) $(`#wz-h-${stepId()}`).focus({ preventScroll: true });
}

// ---------- saving ----------
async function save(what) { await api.save(rec(), what); }

function savePersonFields() {
  const r = rec();
  const name = $("#wz-person").value.trim();
  const reach = $("#wz-person-reach").value.trim();
  const before = r.afterDeath.person || {};
  if ((before.name || "") === name && (before.howToReach || "") === reach) return false;
  if (name || reach) r.afterDeath.person = { name, howToReach: reach };
  else delete r.afterDeath.person;
  return true;
}

function err(id, msg, focusSel) {
  $(id).textContent = msg;
  if (focusSel) $(focusSel).focus();
}

async function next() {
  if (busy) return;
  busy = true;
  try {
    const r = rec();
    const id = stepId();
    if (id === "start") {
      if (!$("#wz-consent").checked) { err("#wz-consent-err", "Please check the box to go on.", "#wz-consent"); return; }
      if (!hasConsent(r, CONFIG.CONSENT_VIDEO_VERSION)) recordConsent(r, { videoVersion: CONFIG.CONSENT_VIDEO_VERSION });
      completeStep(r, id);
      await save("Setup guide: said I watched and understand the welcome");
    } else if (id === "records") {
      if (hasPending($("#wz-privacy"))) { err("#wz-privacy-err", "Please answer the warning first: pick Yes or No.", "#wz-privacy .pv-warn"); return; }
      completeStep(r, id, { skipped: !r.sources.length });
      await save("Setup guide: records and sharing");
    } else if (id === "choices") {
      const pick = $('input[name="wz-afterdeath"]:checked');
      if (!pick) { err("#wz-after-err", "Please pick one choice to go on. You can change it later.", 'input[name="wz-afterdeath"]'); return; }
      chooseAfterDeath(r, pick.value);
      savePersonFields();
      const v = aiPicked();
      if (v && v !== NO_AI) r.ai = { name: v };
      else if (v === NO_AI) delete r.ai;
      completeStep(r, id, { skipped: !v || v === NO_AI, skipId: "ai" });
      finishOnboarding(r);
      await save("Finished the setup guide");
      close(true);
      return;
    } else {
      completeStep(r, id);
      await save(`Setup guide: ${STEPS[index].title}`);
    }
    show(index + 1);
  } finally { busy = false; }
}

async function back() {
  if (busy || index === 0) return;
  cancelPending();
  const r = rec();
  if (stepId() === "choices" && savePersonFields()) await save("Setup guide: updated my trusted person");
  setStep(r, STEP_IDS[index - 1]);
  await save(null);
  show(index - 1);
}

async function later() {
  cancelPending();
  const r = rec();
  if (stepId() === "choices" && savePersonFields()) await save("Setup guide: updated my trusted person");
  setStep(r, stepId());
  await save(null);
  close(false);
}

function close(finished) {
  if (window.CureBranchA11y) CureBranchA11y.stopSpeech();
  $("#wizard").hidden = true;
  document.documentElement.classList.remove("wz-open");
  api.onClose({ finished });
}

// ---------- records step ----------
function filesStatus(kind, msg) {
  $("#wz-files-status").innerHTML = msg ? `<p class="notice ${kind}">${msg}</p>` : "";
}

async function connect() {
  const r = rec();
  const portal = portalPicked();
  $("#wz-connect-err").textContent = "";
  if (!portal) { err("#wz-connect-err", "Please pick your portal first.", 'input[name="wz-portal"]'); return; }
  r.onboarding.portal = portal;
  setStep(r, "records");
  await save(null);
  if (CONFIG.SMART_CLIENT_ID) {
    const url = $("#wz-fhir").value.trim();
    if (!/^https:\/\//i.test(url)) { err("#wz-connect-err", "Please type your hospital's portal address. It starts with https://", "#wz-fhir"); return; }
    startSmartConnect(url); // this page goes to the hospital's login and comes back; the guide reopens here
    return;
  }
  const btn = $("#wz-connect");
  btn.disabled = true;
  try {
    await api.addSource(await stubPortalImport(portal));
    filesStatus("ok", "<strong>Connected (demo).</strong> Made-up EXAMPLE records were added. Nothing left this device.");
  } catch (e) {
    filesStatus("err", `<strong>Could not connect.</strong> ${esc(e.message || "")}`);
  } finally { btn.disabled = false; }
  renderFiles(); updateNav();
}

async function attach(sourceId, fileList) {
  const r = rec();
  let added = 0;
  for (const f of [...fileList]) {
    try {
      if (f.size > MAX_FILE_BYTES) { filesStatus("err", `<strong>${esc(f.name)} is too big.</strong> The limit is ${sizeWords(MAX_FILE_BYTES)}.`); continue; }
      const id = crypto.randomUUID();
      const meta = attachmentMeta(r, { id, sourceId, name: f.name, mediaType: f.type, size: f.size }); // throws unless sourceId is an official record
      await putFile(id, f);
      (r.files = r.files || []).push(meta);
      await save(`Added a supporting ${meta.kind === "photo" ? "photo" : "file"} (from patient, kept on this device)`);
      added++;
    } catch (e) {
      filesStatus("err", `<strong>Could not add ${esc(f.name || "this file")}.</strong> ${esc(e.message || "")}`);
      return;
    }
  }
  if (added) filesStatus("ok", `<strong>Added ${added === 1 ? "1 supporting file" : added + " supporting files"}.</strong> Marked "supporting, from patient". Saved on this device only.`);
  renderFiles(); updateNav();
  $("#wz-files-status").setAttribute("tabindex", "-1"); $("#wz-files-status").focus();
}

async function removeItem(token) {
  const [type, id] = token.split(":");
  const r = rec();
  if (type === "file") {
    await deleteFile(id);
    r.files = (r.files || []).filter((f) => f.id !== id);
    if (!r.files.length) delete r.files;
  } else {
    for (const fid of removeSource(r, id)) await deleteFile(fid);
  }
  await save(type === "file" ? "Removed a supporting file" : "Removed a record");
  filesStatus("", "Removed.");
  renderFiles(); updateNav();
  $("#wz-h-records").focus();
}

// ---------- wiring ----------
function wire() {
  $("#wz-next").addEventListener("click", next);
  $("#wz-back").addEventListener("click", back);
  $("#wz-later").addEventListener("click", later);
  $("#wz-consent").addEventListener("change", () => { $("#wz-consent-err").textContent = ""; });
  $("#wz-new-code").addEventListener("click", async () => {
    const r = rec();
    if (highestShared(r) || r.afterDeath.stewardKeyHash) return;
    r.code = randomCode(CONFIG.CODE_LENGTH);
    await save("Picked a different private code");
    $("#wz-code").textContent = r.code;
    $("#wz-code-note").textContent = `New code saved: ${r.code}.`;
  });
  $("#wz-portal-list").addEventListener("change", () => { $("#wz-connect-err").textContent = ""; showConnect(); });
  $("#wz-connect").addEventListener("click", connect);
  $("#wz-files").addEventListener("change", (e) => {
    const inp = e.target.closest("[data-attach-for]");
    if (inp) { attach(inp.dataset.attachFor, inp.files); }
  });
  $("#wz-files").addEventListener("click", (e) => {
    const c = e.target.closest("[data-wz-check]");
    if (c) { runCheck(c.dataset.wzCheck); return; }
    const b = e.target.closest("[data-wz-remove]");
    if (b) removeItem(b.dataset.wzRemove);
  });
  $("#wz-ai-list").addEventListener("change", async () => {
    showAiSteps(); updateNav();
    const r = rec();
    const v = aiPicked();
    if (v && v !== NO_AI) r.ai = { name: v };
    else if (v === NO_AI) delete r.ai;
    await save(v && v !== NO_AI ? `Setup guide: I use ${v}` : "Setup guide: skipped the AI step");
    if (stepId() === "choices") renderSummary();
  });
  $$('input[name="wz-afterdeath"]').forEach((x) => x.addEventListener("change", async () => {
    $("#wz-after-err").textContent = "";
    chooseAfterDeath(rec(), x.value);
    await save(`Setup guide: after-death choice: ${AFTER_WORDS[x.value]}`);
    if (stepId() === "choices") renderSummary();
  }));
  $("#wz-person").addEventListener("input", () => { if (stepId() === "choices") { savePersonFields(); renderSummary(); } });
}

/** Called by app.js after the sharing level changes (the picker is shared with Settings). */
export function refreshWizard() {
  if (!api || $("#wizard").hidden) return;
  if (stepId() === "records") updateNav();
}

export function initWizard(options) {
  api = options;
  wire();
}

/** Open the guide. restart = from Settings (start over at step 1, answers kept). */
export async function openWizard({ restart = false } = {}) {
  const r = rec();
  if (restart) { restartOnboarding(r); await save("Started the setup guide again"); }
  else if (!r.onboarding) { setStep(r, STEP_IDS[0]); await save("Started the setup guide"); }
  if (api.onOpen) api.onOpen();
  document.documentElement.classList.add("wz-open");
  $("#wizard").hidden = false;
  show(restart ? 0 : resumeIndex(r));
}
