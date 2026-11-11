// The sharing-level picker, used in the setup guide and in Settings (same markup and rules).
// Nothing is preselected. Picking level 2-4, or moving down from a level already shared,
// shows a plain warning first; the change only happens after "Yes".
import { LEVELS, NEVER_SHARED, changeWarning, privacyLevel, levelName, statusWords } from "./privacy.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pickers = [];

function markup(id) {
  return `<fieldset class="choice-list pv-levels" aria-describedby="${id}-never">
    <legend class="pv-legend">Pick how much to share</legend>
    ${LEVELS.map((l) => `<label class="pv-level" for="${id}-${l.id}"><input type="radio" name="${id}-level" id="${id}-${l.id}" value="${l.id}">
      <span><strong>${l.n}. ${esc(l.name)}</strong> <span class="pv-tag">(${esc(l.tag)})</span><br><span class="pv-what">${esc(l.what)}</span></span></label>`).join("")}
  </fieldset>
  <p class="wz-note" id="${id}-never">${esc(NEVER_SHARED)}</p>
  <div class="notice pv-warn" id="${id}-warn" role="group" aria-labelledby="${id}-warn-title" aria-describedby="${id}-warn-body" tabindex="-1" hidden>
    <p class="pv-warn-title" id="${id}-warn-title"></p>
    <div id="${id}-warn-body"></div>
    <div class="pv-warn-btns">
      <button type="button" class="btn btn-primary" data-pv-yes></button>
      <button type="button" class="btn" data-pv-no></button>
    </div>
  </div>
  <p class="pv-status" id="${id}-status" role="status" aria-live="polite"></p>`;
}

function sync(p) {
  const r = p.getRecord();
  const lvl = privacyLevel(r);
  p.el.querySelectorAll('input[type="radio"]').forEach((x) => { x.checked = x.value === lvl; });
  const st = statusWords(r);
  p.el.querySelector(".pv-status").textContent = `Saved: ${levelName(lvl)}${lvl ? "" : " (nothing is shared)"}. ${st.help}`;
}

function hideWarn(p) { p.pending = null; p.el.querySelector(".pv-warn").hidden = true; }

async function apply(p, level) {
  hideWarn(p);
  await p.apply(level);
  refreshPickers();
  p.el.querySelector(".pv-status").textContent = `Saved: ${levelName(level)}. ${statusWords(p.getRecord()).help}`;
}

/** Mount one picker. options = { getRecord(), apply(level) -> Promise } */
export function mountPrivacyPicker(el, options) {
  const id = "pv-" + (el.dataset.privacyPicker || pickers.length);
  el.innerHTML = markup(id);
  const p = { el, id, pending: null, ...options };
  pickers.push(p);
  el.addEventListener("change", (e) => {
    const x = e.target.closest('input[type="radio"]');
    if (!x) return;
    const w = changeWarning(p.getRecord(), x.value);
    if (!w.needsConfirm) { apply(p, x.value); return; }
    p.pending = x.value;
    const box = el.querySelector(".pv-warn");
    box.classList.toggle("err", w.kind !== "going-public");
    el.querySelector(".pv-warn-title").textContent = w.title;
    el.querySelector(`#${id}-warn-body`).innerHTML = w.lines.map((t) => `<p>${esc(t)}</p>`).join("");
    el.querySelector("[data-pv-yes]").textContent = w.yes;
    el.querySelector("[data-pv-no]").textContent = w.no;
    el.querySelector(".pv-status").textContent = `Not saved yet. Read the warning, then pick Yes or No.`;
    box.hidden = false;
    box.focus();
  });
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-pv-yes]") && p.pending) { const lvl = p.pending; apply(p, lvl).then(() => { const r = el.querySelector(`#${id}-${lvl}`); if (r) r.focus(); }); }
    if (e.target.closest("[data-pv-no]")) { const lvl = p.pending; hideWarn(p); sync(p); const r = el.querySelector(`#${id}-${lvl}`); if (r) r.focus(); }
  });
  sync(p);
  return p;
}

/** Re-sync every picker with the saved record (drops any unconfirmed pick). */
export function refreshPickers() { pickers.forEach((p) => { if (!p.pending) sync(p); }); }
/** Is a pick waiting for Yes / No inside this element? */
export function hasPending(within) { return pickers.some((p) => p.pending && (!within || within.contains(p.el))); }
/** Drop an unconfirmed pick (e.g. when the patient leaves the step). */
export function cancelPending() { pickers.forEach((p) => { if (p.pending) { hideWarn(p); sync(p); } }); }
