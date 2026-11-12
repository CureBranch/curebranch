// Shared by every page: the site header (menu drawer on small screens), the Translate panel,
// the "?" help buttons, copy buttons, and the cancer-tree list in the side menu.
import { wireHelp, helpTip } from "./help.js";
import { initTranslate } from "./translate.js";
import { loadPublicData, navHtml, wireNav, markCurrent } from "./public-data.js";

const $ = (s, r = document) => r.querySelector(s);
const wide = () => window.matchMedia("(min-width: 1024px)").matches;
const OUTSIDE = ["main", ".chrome", ".site-footer", "#banners"];

export function openMenu() {
  const nav = $("#sidenav"); if (!nav || wide()) return;
  nav.classList.add("open");
  nav.setAttribute("role", "dialog"); nav.setAttribute("aria-modal", "true"); nav.setAttribute("aria-labelledby", "sidenav-title");
  nav.removeAttribute("aria-label");
  $("#nav-backdrop").hidden = false;
  $("#nav-toggle").setAttribute("aria-expanded", "true");
  OUTSIDE.forEach((q) => document.querySelectorAll(q).forEach((el) => { el.inert = true; }));
  document.documentElement.classList.add("nav-open");
  const first = nav.querySelector(".site-links a"); if (first) first.focus();
}
export function closeMenu(returnFocus = true) {
  const nav = $("#sidenav"); if (!nav || !nav.classList.contains("open")) return;
  nav.classList.remove("open"); nav.removeAttribute("role"); nav.removeAttribute("aria-modal"); nav.removeAttribute("aria-labelledby");
  nav.setAttribute("aria-label", "Menu and cancer trees");
  $("#nav-backdrop").hidden = true;
  $("#nav-toggle").setAttribute("aria-expanded", "false");
  OUTSIDE.forEach((q) => document.querySelectorAll(q).forEach((el) => { el.inert = false; }));
  document.documentElement.classList.remove("nav-open");
  if (returnFocus) $("#nav-toggle").focus();
}

/** Mark the current page in the header and the menu (aria-current="page"). */
export function markNav(name, cancerId, path) {
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === name || (name === "cancer" && a.dataset.nav === "cancers");
    if (on) a.setAttribute("aria-current", a.dataset.nav === name ? "page" : "true"); else a.removeAttribute("aria-current");
  });
  const host = $("#cancer-nav");
  if (host && host.firstChild) markCurrent(host, cancerId || null, path || null);
}

let navReady = null;
export function fillCancerNav() {
  if (navReady) return navReady;
  navReady = loadPublicData().then(() => {
    const host = $("#cancer-nav"); if (!host || host.dataset.ready) return;
    host.innerHTML = navHtml(); host.dataset.ready = "1";
    host.setAttribute("aria-labelledby", "cancer-nav-title"); host.removeAttribute("aria-label");
    wireNav(host);
  });
  return navReady;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = document.createElement("textarea");
  ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch {}
  ta.remove(); return ok;
}

/** Turn <span data-help-slot="term"> placeholders in static HTML into "?" buttons. */
export function fillHelpSlots(root = document) {
  root.querySelectorAll("[data-help-slot]").forEach((el) => { el.outerHTML = helpTip(el.dataset.helpSlot, el.dataset.helpLabel); });
}

export function initSite() {
  if (document.documentElement.dataset.site) return; document.documentElement.dataset.site = "1";
  const chrome = $(".chrome");
  if (chrome) {
    const setH = () => document.documentElement.style.setProperty("--chrome-h", `${chrome.offsetHeight}px`);
    setH(); new ResizeObserver(setH).observe(chrome);
  }
  const t = $("#nav-toggle");
  if (t) {
    t.addEventListener("click", () => ($("#sidenav").classList.contains("open") ? closeMenu() : openMenu()));
    $("#nav-close").addEventListener("click", () => closeMenu());
    $("#nav-backdrop").addEventListener("click", () => closeMenu());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#sidenav").classList.contains("open")) { e.preventDefault(); closeMenu(); } });
    window.matchMedia("(min-width: 1024px)").addEventListener("change", () => closeMenu(false));
    $("#sidenav").addEventListener("click", (e) => { if (e.target.closest("a[href]")) closeMenu(false); });
  }
  fillHelpSlots(document);
  wireHelp(document);
  initTranslate();
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy]"); if (!b) return;
    const src = document.getElementById(b.dataset.copy);
    const ok = await copyText(src ? src.value || src.textContent : "");
    const st = b.parentElement.querySelector(".copy-status");
    if (st) st.textContent = ok ? "Copied. Now open your AI and paste it." : "Could not copy. Select the text in the box and copy it yourself.";
    if (!ok && src && src.select) src.select();
  });
  if (!document.body.dataset.app) {
    // Static pages (How it started, profiles, 404): fill the menu and mark the current page.
    fillCancerNav();
    markNav(document.body.dataset.page || "");
  }
}
initSite();
