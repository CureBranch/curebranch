// Builds the public tree from a list of public summaries. Counting rules:
//  * every public summary is SHOWN;
//  * only summaries with verification.status === "verified" are COUNTED in stats;
//  * one person, one vote: if two verified summaries share a personKey, only the
//    most recently updated one counts (personKey is an open choice; see docs).
//  * example summaries are never mixed with real ones (caller passes one kind).

export function countable(summaries) {
  const byPerson = new Map();
  const noKey = [];
  for (const s of summaries) {
    if (s.visibility !== "public" || s.verification.status !== "verified") continue;
    if (!s.personKey) { noKey.push(s); continue; }
    const prev = byPerson.get(s.personKey);
    if (!prev || String(s.updated) > String(prev.updated)) byPerson.set(s.personKey, s);
  }
  return new Set([...noKey, ...byPerson.values()]);
}

function newNode(name) { return { name, shown: 0, counted: 0, children: new Map(), summaries: [] }; }

export function buildTree(summaries) {
  const visible = summaries.filter((s) => s.visibility === "public");
  const counted = countable(visible);
  const root = newNode("All");
  for (const s of visible) {
    let node = root;
    const isCounted = counted.has(s);
    node.shown++; if (isCounted) node.counted++;
    for (const part of s.branch.path) {
      if (!node.children.has(part)) node.children.set(part, newNode(part));
      node = node.children.get(part);
      node.shown++; if (isCounted) node.counted++;
    }
    node.summaries.push({ summary: s, counted: isCounted });
  }
  return root;
}

/** All summaries at or below a node. */
export function collect(node) {
  return [...node.summaries, ...[...node.children.values()].flatMap(collect)];
}

/**
 * Plain counts per treatment, from COUNTED summaries only: how many people tried it,
 * and how many reported each coarse status afterwards. No scores, no rankings.
 */
export function treatmentStats(items) {
  const stats = new Map();
  for (const { summary: s, counted } of items) {
    if (!counted) continue;
    (s.treatments || []).forEach((t, i) => {
      const k = t.name;
      if (!stats.has(k)) stats.set(k, { name: k, people: 0, status: {} });
      const st = stats.get(k);
      st.people++;
      // The first status reported at or after this treatment started (combination drugs share it).
      const next = (s.outcomes || []).find((o) => typeof o.afterTreatment === "number" && o.afterTreatment >= i);
      const label = next ? next.status : "not-reported";
      st.status[label] = (st.status[label] || 0) + 1;
    });
  }
  return [...stats.values()].sort((a, b) => b.people - a.people || a.name.localeCompare(b.name));
}
