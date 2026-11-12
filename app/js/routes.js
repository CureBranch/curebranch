// Every page has a real address (no "#/" routes). Used by the app (routing, titles) and by
// tools/stamp-build.mjs, which writes one static index.html per address for GitHub Pages.
export const SITE = "https://curebranch.ai";

/** Pages that live inside the app shell (index.html). `screen` is the <section id="s-..."> shown. */
export const PAGES = [
  { name: "home", screen: "home", path: "/", nav: "Home",
    title: "CureBranch: a free, open cancer tree that patients grow together",
    desc: "CureBranch is a free, open-source cancer tree. Learn about your cancer in plain English, from trusted public sources, and choose whether to share your own story to help others." },
  { name: "cancers", screen: "cancers", path: "/cancers/", nav: "Cancer trees",
    title: "All cancer trees",
    desc: "Every cancer tree in CureBranch, grouped by part of the body, with plain-English facts from public sources." },
  { name: "tree", screen: "tree", path: "/tree/", nav: "The tree",
    title: "The tree",
    desc: "A picture of all cancer types as one living tree. Each limb is a cancer type and each tip is a gene often changed in it." },
  { name: "how-it-works", screen: "start", path: "/how-it-works/", nav: "How it works",
    title: "How CureBranch works",
    desc: "How CureBranch works, step by step, in plain English: your records stay with you, you pick what to share, and you can use your own AI." },
  { name: "help", screen: "help", path: "/help/", nav: "Help",
    title: "Help: questions and answers",
    desc: "Plain answers to common questions about CureBranch, cancer words, privacy, records and using your own AI." },
  { name: "privacy", screen: "privacy", path: "/privacy/", nav: "Privacy",
    title: "Privacy: what stays private and what you can share",
    desc: "What CureBranch keeps private, the 4 sharing levels, and what happens if you change your mind." },
  { name: "import", screen: "import", path: "/import/", nav: "Add records",
    title: "Add your records",
    desc: "Add your own cancer records to CureBranch. They are read on your device and never uploaded." },
  { name: "my-branch", screen: "repo", path: "/my-branch/", nav: "My branch",
    title: "My branch",
    desc: "Your own records, your branch on the tree and your summary. Kept on this device." },
  { name: "settings", screen: "settings", path: "/settings/", nav: "Settings",
    title: "Settings",
    desc: "Your CureBranch settings: how much you share, after you are gone, your profile, your AI and your data." },
  { name: "accessibility", screen: "a11y", path: "/accessibility/", nav: "Accessibility",
    title: "Accessibility",
    desc: "How CureBranch works for everyone, and how to change text size, fonts, colors and motion." },
  { name: "sources", screen: "sources", path: "/sources/", nav: "Sources",
    title: "Sources and licenses",
    desc: "Where every published number in CureBranch comes from, and the license for each source." },
];
/** Separate static pages (their own HTML file). */
export const STATIC_PAGES = [
  { name: "how-it-started", file: "how-it-started.html", path: "/how-it-started/",
    title: "How CureBranch started", desc: "How CureBranch started, what it is for, and what open source means, in plain English." },
];
/** Old screen names (and old #hash addresses) mapped to the new pages. */
export const ALIASES = { start: "how-it-works", repo: "my-branch", record: "my-branch", a11y: "accessibility", explore: "tree" };

export const slug = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Sub-pages of a cancer tree: subtypes (from TCGA studies and SEER) and biomarkers with FDA-approved drugs. */
export function subPages(c) {
  const out = []; const seen = new Set();
  const add = (p) => { if (!p.slug || seen.has(p.slug)) return; seen.add(p.slug); out.push(p); };
  for (const g of c.genomics || []) {
    const s = slug(g.subtype.replace(/\s*\([^)]*\)\s*/g, " "));
    if ([c.name, c.treeLabel, c.name.replace(/\s*\([^)]*\)/g, "")].some((x) => slug(x) === s)) continue;
    add({ slug: s, kind: "subtype", label: g.subtype, name: g.subtype });
  }
  for (const x of c.seerSubtypes || []) {
    const s = slug(x.name.replace(/\s*\([^)]*\)\s*/g, " "));
    add({ slug: s, kind: "subtype", label: x.name.replace(/\s*\([^)]*\)\s*$/, ""), name: x.name });
  }
  for (const t of c.therapies || []) {
    const wild = /wild-type/i.test(t.biomarker);
    const s = wild ? slug(t.biomarker) : `${slug(t.biomarker)}-positive`;
    add({ slug: s, kind: "biomarker", label: wild ? t.biomarker : `${t.biomarker}-positive`, biomarker: t.biomarker });
  }
  return out;
}
export const cancerPath = (c, sub) => `/cancers/${c.id}/${sub ? `${sub.slug}/` : ""}`;

/** Title, description and canonical address for any route. */
export function pageMeta(r) {
  if (r.page) return { title: r.page.title, desc: r.page.desc, path: r.page.path };
  const c = r.cancer;
  if (r.sub) {
    const what = r.sub.kind === "biomarker" ? `${r.sub.label} ${c.name.replace(/ cancer$/i, "").toLowerCase()} cancer` : r.sub.label;
    const title = r.sub.kind === "biomarker" ? `${r.sub.label} ${lowerName(c)}` : `${r.sub.label} (${lowerName(c)})`;
    return { title, path: cancerPath(c, r.sub),
      desc: r.sub.kind === "biomarker"
        ? `What ${r.sub.label} means in ${lowerName(c)}, in plain English: FDA-approved drugs, recruiting clinical trials and how to use this page with your own AI.`
        : `Plain-English facts about ${what}: common gene changes from public research, with sources, and how to use this page with your own AI.` };
  }
  return { title: c.name, path: cancerPath(c),
    desc: `${c.name} in plain English: how common it is, survival, subtypes, gene changes, FDA-approved drugs and recruiting clinical trials, from public sources. With a ready-made prompt for your own AI.` };
}
function lowerName(c) { return /^[A-Z]{2,}/.test(c.name) ? c.name : c.name.charAt(0).toLowerCase() + c.name.slice(1); }

/** Every address the build should write, with its meta. */
export function allRoutes(data) {
  const out = PAGES.map((p) => ({ page: p }));
  for (const c of (data && data.cancers) || []) {
    out.push({ cancer: c });
    for (const s of subPages(c)) out.push({ cancer: c, sub: s });
  }
  return out.map((r) => ({ ...r, ...pageMeta(r) }));
}

/** Address -> route, or null if the address is not an app page. */
export function resolvePath(pathname, data) {
  let p = String(pathname || "/").replace(/\/index\.html$/, "/");
  if (!p.endsWith("/")) p += "/";
  const page = PAGES.find((x) => x.path === p);
  if (page) return { page };
  const m = p.match(/^\/cancers\/([a-z0-9-]+)\/(?:([a-z0-9-]+)\/)?$/);
  if (!m) return null;
  const c = ((data && data.cancers) || []).find((x) => x.id === m[1]);
  if (!c) return null;
  if (!m[2]) return { cancer: c };
  const sub = subPages(c).find((s) => s.slug === m[2]);
  return sub ? { cancer: c, sub } : null;
}

/** Old screen names and old hash addresses ("tree", "#cancer/lung", "#/repo", "cancer/lung/g-lung-EGFR") -> new address. */
export function legacyToPath(route) {
  let r = decodeURIComponent(String(route || "")).replace(/^#?\/?/, "");
  if (!r) return "/";
  const [name, a, b] = r.split("/");
  if (name === "cancer" || name === "cancers") {
    if (!a) return "/cancers/";
    if (!b) return `/cancers/${a}/`;
    return /^(g|sub|therapies|stats|stage|th|src|ai)-/.test(b) ? `/cancers/${a}/#${b}` : `/cancers/${a}/${b}/`;
  }
  const page = PAGES.find((p) => p.name === (ALIASES[name] || name));
  if (page) return page.path;
  if (name === "home") return "/";
  return null;
}
