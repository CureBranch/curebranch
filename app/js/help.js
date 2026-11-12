// Plain-English help: "?" buttons (disclosure / toggletip pattern) and the Help page questions.
// A "?" is a real <button> with aria-expanded and aria-controls. Pressing it shows a short
// explanation right below, in the reading order, so keyboard and screen-reader users get it too.
// Escape closes it and puts focus back on the button. Nothing opens on hover only.

export const TERMS = {
  branch: { term: "branch", text: "Your branch is your own spot on the tree. It is made from your cancer type and, if you know it, a gene change in your tumor. People whose cancer looks alike end up on nearby branches." },
  tree: { term: "the tree", text: "The tree is a picture of many cancers together. Each big limb is one type of cancer. Smaller branches split off for subtypes and gene changes." },
  "cancer-tree": { term: "cancer tree", text: "A cancer tree is one type of cancer, like breast cancer, with its subtypes and common gene changes listed under it." },
  subtype: { term: "subtype", text: "A subtype is a smaller group inside one cancer type. Doctors name subtypes by how the cells look under a microscope or by a test result. Subtypes can grow and respond to treatment differently." },
  biomarker: { term: "biomarker", text: "A biomarker is something a lab test can find in a tumor or in blood, like a gene change or a protein. Some drugs only work when a certain biomarker is there. Your pathology or genetic test report may list yours." },
  positive: { term: "positive", text: "\"Positive\" here means a test found this marker in the cancer. For example, HER2-positive means the cancer cells have extra HER2 protein." },
  gene: { term: "gene", text: "A gene is a small piece of the body's instructions (DNA). Cancer cells often have changes in certain genes. These changes are in the tumor, and most are not passed down in families." },
  mutation: { term: "mutation", text: "A mutation is a change in a gene. Some changes help a cancer grow. Others do nothing. A test on the tumor can look for them." },
  "mutation-rate": { term: "tumors with a mutation", text: "This is the share of tumors in a big research study that had a change in this gene. For example, 30% means about 30 out of every 100 tumors tested had it. It does not tell you if your tumor has it. Only a test on your tumor can." },
  "wild-type": { term: "wild-type", text: "\"Wild-type\" means no change was found in that gene. Some drugs work best when a gene is wild-type." },
  "new-cases": { term: "new cases", text: "How many people in the United States are expected to find out they have this cancer this year. It is an estimate made from past years." },
  deaths: { term: "estimated deaths", text: "How many people in the United States are expected to die from this cancer this year. It is an estimate. It cannot tell what will happen to one person." },
  survival: { term: "5-year relative survival", text: "Out of 100 people with this cancer, about this many are alive 5 years after finding out, compared with people the same age without it. It is based on people diagnosed years ago, so newer treatments may do better. It is an average for a big group, not a prediction for you." },
  rate: { term: "rate per 100,000", text: "How many new cases there are for every 100,000 people each year. It makes it fair to compare places or years with different numbers of people." },
  "median-age": { term: "median age", text: "Half the people were younger than this when they found out, and half were older." },
  stage: { term: "stage", text: "Stage tells how far a cancer has spread. Localized means it is only where it started. Regional means it reached nearby areas or lymph nodes. Distant means it spread to faraway parts of the body." },
  seer: { term: "SEER", text: "SEER is a program of the U.S. National Cancer Institute. It counts cancer cases across the United States and publishes the numbers for free. It is where our numbers on new cases and survival come from." },
  tcga: { term: "TCGA", text: "TCGA (The Cancer Genome Atlas) was a large U.S. research project. Scientists studied the genes of more than 10,000 tumors. We use its public results to show which genes are often changed in each cancer." },
  cbioportal: { term: "cBioPortal", text: "cBioPortal is a free website where scientists share cancer gene research, including TCGA. We read the TCGA numbers from it." },
  fda: { term: "FDA-approved drug", text: "The FDA is the U.S. agency that approves medicines. Each approved drug has a label that says which cancers and which biomarkers it is approved for. We list a drug only when its label names both." },
  trial: { term: "clinical trial", text: "A clinical trial is a research study that tests a new treatment, or a new way to use an old one, with volunteers. \"Recruiting\" means the study is looking for people to join now. Your doctor can help you see if one fits you." },
  ctgov: { term: "ClinicalTrials.gov", text: "ClinicalTrials.gov is a free U.S. government website that lists clinical trials around the world. Our trial counts link straight to its search." },
  "shared-branches": { term: "patient-shared branches", text: "This counts people who chose to share a summary of their own records here. It starts at 0. It is kept apart from the published research numbers, and only checked records count." },
  privacy: { term: "privacy levels", text: "You pick one of 4 levels. 1) Private: nothing leaves your device. 2) Basic: ranges only, like Stage 3 and age 60 to 69. 3) Detailed: adds exact age and dates. 4) Full: adds your city. Never your name, birthday, street or record numbers." },
  fhir: { term: "FHIR", text: "FHIR (say \"fire\") is the standard way hospitals share health records with apps. When you connect your patient portal, your records arrive in this format." },
  portal: { term: "patient portal", text: "A patient portal is the website or app where you see your own hospital records, like MyChart. CureBranch can connect to it, with your login, to copy your records onto your device." },
  "health-card": { term: "SMART Health Card", text: "A SMART Health Card is a record signed by a hospital or lab, often shared as a QR code. The signature lets us check that it really came from them." },
  verified: { term: "verified", text: "Verified means the record came straight from a hospital or lab and its signature checked out. Only verified records are counted on the tree." },
  code: { term: "your code", text: "Your code is a random set of letters and numbers, like k7x2m9. If you share, people see only this code, never your name." },
  summary: { term: "public summary", text: "Your public summary is the short version of your records that you choose to share. You can see every word of it before anything is shared." },
  ai: { term: "your own AI", text: "An AI is a chat tool like ChatGPT, Claude, Gemini or Grok. CureBranch has no AI of its own. If you use one, you copy a prompt from here and paste it into your AI yourself." },
  "open-source": { term: "open source", text: "Open source means anyone can read, copy and improve the code for free. Nobody can lock it up or sell it." },
  license: { term: "license", text: "A license says how something can be used. Each source we use allows free use, and some ask for credit, so we credit them on every page." },
  steward: { term: "trusted person", text: "The person you name to carry out your choice after you die. Their name stays on your device." },
};

let seq = 0;
/** A "?" button plus its hidden explanation. `label` names what it explains (for screen readers). */
export function helpTip(key, label) {
  const t = TERMS[key];
  if (!t) return "";
  const id = `hp-${key}-${++seq}`;
  const what = label || t.term;
  return `<span class="help-wrap"><button type="button" class="help-btn" aria-expanded="false" aria-controls="${id}" data-help="${key}">` +
    `<span aria-hidden="true">?</span><span class="sr-only">What does "${what}" mean?</span></button>` +
    `<span class="help-pop" id="${id}" hidden><span class="help-pop-t"><strong>${cap(what)}:</strong> ${t.text}</span> ` +
    `<a class="help-more" href="/help/#q-${key}">More in Help</a></span></span>`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Heading with a "?" next to it. The explanation sits below the heading, not inside it. */
export function helpHeading(level, id, text, key, label) {
  return `<div class="hh"><h${level} id="${id}">${text}</h${level}>${helpTip(key, label || text)}</div>`;
}

/** Short box at the top of a page: what this page is, in plain words. */
export function whatIsBox(id, html) {
  return `<aside class="what-is" aria-labelledby="${id}"><h2 class="what-is-h" id="${id}">What is this page?</h2>${html}</aside>`;
}

/** Wire every "?" on the page (event delegation, so new content works too). */
export function wireHelp(root = document) {
  if (root.__cbHelp) return; root.__cbHelp = true;
  root.addEventListener("click", (e) => {
    const b = e.target.closest(".help-btn");
    if (!b) return;
    const pop = document.getElementById(b.getAttribute("aria-controls"));
    const open = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", String(open));
    if (pop) pop.hidden = !open;
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const inPop = e.target.closest && e.target.closest(".help-pop");
    const b = inPop ? document.querySelector(`[aria-controls="${inPop.id}"]`) : e.target.closest && e.target.closest(".help-btn");
    if (!b || b.getAttribute("aria-expanded") !== "true") return;
    e.preventDefault(); e.stopPropagation();
    b.setAttribute("aria-expanded", "false");
    const pop = document.getElementById(b.getAttribute("aria-controls")); if (pop) pop.hidden = true;
    b.focus();
  }, true);
}

// ---------- the Help page: lots of plain questions and answers ----------
export const FAQ = [
  { h: "The basics", qs: [
    ["what-is", "What is CureBranch?", "CureBranch is a free website about cancer. It shows trusted public facts about each type of cancer in plain English. People with cancer can also choose to add a short, private-by-default summary of their own records, so that over time we can all see what helped people with a cancer like theirs."],
    ["cost", "Does it cost anything?", "No. It is free for patients and families. There are no ads and nothing to buy."],
    ["advice", "Is this medical advice?", "No. CureBranch gives information, not medical advice. Numbers here describe big groups of people and cannot tell what will happen to you. Always make care choices with your own doctors."],
    ["emergency", "Can I use it in an emergency?", "No. In an emergency, call your local emergency number."],
    ["q-tree", "What is the tree?", TERMS.tree.text],
    ["q-cancer-tree", "What is a cancer tree?", TERMS["cancer-tree"].text],
    ["q-branch", "What is my branch?", TERMS.branch.text],
    ["q-shared-branches", "Why does it say 0 patient-shared branches?", TERMS["shared-branches"].text + " The research numbers on each page are real and come from public sources."],
    ["q-open-source", "What does open source mean?", TERMS["open-source"].text],
  ] },
  { h: "Cancer words, explained", qs: [
    ["q-subtype", "What is a subtype?", TERMS.subtype.text],
    ["q-biomarker", "What is a biomarker?", TERMS.biomarker.text],
    ["q-positive", "What does \"positive\" mean, like HER2-positive?", TERMS.positive.text],
    ["q-wild-type", "What does \"wild-type\" mean?", TERMS["wild-type"].text],
    ["q-gene", "What is a gene?", TERMS.gene.text],
    ["q-mutation", "What is a mutation?", TERMS.mutation.text],
    ["q-mutation-rate", "What does \"tumors with a mutation\" mean?", TERMS["mutation-rate"].text],
    ["q-stage", "What does stage mean?", TERMS.stage.text],
    ["q-survival", "What does 5-year relative survival mean?", TERMS.survival.text],
    ["q-new-cases", "What are \"new cases\"?", TERMS["new-cases"].text],
    ["q-deaths", "What are \"estimated deaths\"?", TERMS.deaths.text],
    ["q-rate", "What is a rate per 100,000?", TERMS.rate.text],
    ["q-median-age", "What is median age?", TERMS["median-age"].text],
    ["q-trial", "What is a clinical trial?", TERMS.trial.text],
    ["q-fda", "What is an FDA-approved drug?", TERMS.fda.text],
  ] },
  { h: "Where the numbers come from", qs: [
    ["q-seer", "What is SEER?", TERMS.seer.text],
    ["q-tcga", "What is TCGA?", TERMS.tcga.text],
    ["q-cbioportal", "What is cBioPortal?", TERMS.cbioportal.text],
    ["q-ctgov", "What is ClinicalTrials.gov?", TERMS.ctgov.text],
    ["q-license", "Can you use these numbers?", TERMS.license.text + " The full list is on the Sources page."],
    ["fresh", "How new are the numbers?", "Each number shows the date we copied it. Survival numbers come from people diagnosed some years ago, because it takes 5 years to measure 5-year survival."],
  ] },
  { h: "Your records and privacy", qs: [
    ["where", "Where are my records kept?", "Only on your own phone or computer, inside this website's storage in your browser. CureBranch has no server that keeps your records."],
    ["q-privacy", "What are the privacy levels?", TERMS.privacy.text],
    ["undo", "Can I change my mind?", "Yes. You can move to a lower level at any time. That stops sharing from then on. But anything already shared may have been copied, so only share what you would be OK with the world knowing someday."],
    ["q-code", "What is my code?", TERMS.code.text],
    ["q-summary", "What is a public summary?", TERMS.summary.text],
    ["q-portal", "What is a patient portal?", TERMS.portal.text],
    ["q-fhir", "What is FHIR?", TERMS.fhir.text],
    ["q-health-card", "What is a SMART Health Card?", TERMS["health-card"].text],
    ["q-verified", "What does verified mean?", TERMS.verified.text],
    ["new-device", "How do I move to a new phone or computer?", "Go to Settings and press Download my full backup. Keep that file private. It holds your records and your private key."],
    ["delete", "How do I delete everything?", "Go to Settings and press Delete everything on this device."],
    ["q-steward", "What is a trusted person?", TERMS.steward.text],
  ] },
  { h: "Using your own AI", qs: [
    ["q-ai", "Does CureBranch use AI on my records?", "No. CureBranch never runs AI on your data. If you want an AI to help, you use your own, like ChatGPT, Claude, Gemini, Grok or Copilot, and you pay for it yourself if it costs anything."],
    ["ai-how", "How do I use a cancer page with my AI?", "Open the page for your cancer. Press Copy the prompt. Open your AI and paste it. Then add the parts of your own records you are comfortable sharing, like your pathology report. Ask your AI to explain it in plain words, and write down questions for your doctor."],
    ["ai-safe", "Is it safe to paste my records into an AI?", "That depends on the AI company and your settings. Read its privacy rules first. Leave out your name, birthday, address and record numbers. AI can be wrong, so check what it says with your care team."],
    ["ai-which", "Which AI should I use?", "Any chat AI you trust. The steps on each cancer page work for ChatGPT, Claude, Gemini, Grok, Copilot and others."],
  ] },
  { h: "Using the website", qs: [
    ["translate", "Can I read this in another language?", "Yes. Press Translate at the top of the page. If your browser can translate on your own device, you can do it right there. Otherwise we show you how to use your browser's built-in translate, which works for over 100 languages."],
    ["a11y", "Can I make the text bigger or change colors?", "Yes. Press Accessibility at the top of the page. You can change text size, font, spacing, colors and motion. Screen readers like VoiceOver, TalkBack, NVDA, JAWS and Narrator also work."],
    ["phone", "Does it work on my phone?", "Yes. It works on phones, tablets and computers. You can also add it to your home screen like an app."],
    ["offline", "Does it work without internet?", "After your first visit, the main pages keep working without internet."],
  ] },
];

/** Every term used on a "?" button has a Help answer with id q-<term>. */
export function faqHtml() {
  return FAQ.map((g, gi) => `<section class="sec faq-sec" aria-labelledby="faq-h-${gi}"><h2 id="faq-h-${gi}">${g.h}</h2>
    <dl class="faq">${g.qs.map(([id, q, a]) => `<div class="faq-item"><dt id="${id.startsWith("q-") ? id : "q-" + id}" tabindex="-1">${q}</dt><dd>${a}</dd></div>`).join("")}</dl></section>`).join("");
}
