// DUBAWA election coverage pull — Node 18+
// Run: node dubawa-elections.mjs
// Output: ./out/master.csv, ./out/review.csv, ./out/manifest/<election>.json

import { writeFileSync, mkdirSync } from "node:fs";

const MAIN = "https://dubawa.org";
const GHANA = "https://ghana.dubawa.org"; // Ghana coverage lives on the Ghana site
const DAYS_BEFORE = 42; // 6 weeks before election day
const DAYS_AFTER = 28;  // 4 weeks after
const CAT_ONLY_DAYS = 180; // category-only stragglers must land within 6 months of the vote

// Country category IDs (parent 3136 on dubawa.org)
const CAT = {
  Benin: 4519, "Cote d'Ivoire": 4269, Liberia: 1960, Guinea: 4482,
  Senegal: 4044, "Sierra Leone": 1268,
  Nigeria: null, Ghana: null, "Guinée Bissau": 4270,
};

// Keywords per country: country names, electoral bodies, candidates, parties
const KW = {
  Nigeria: ["nigeria", "inec", "irev", "tinubu", "atiku", "peter obi", "kwankwaso", "apc", "pdp", "labour party"],
  "Sierra Leone": ["sierra leone", "freetown", "julius maada bio", "maada bio", "samura kamara", "slpp", "apc sierra"],
  Liberia: ["liberia", "monrovia", "george weah", "weah", "joseph boakai", "boakai", "nec liberia", "nimba", "cdc liberia", "unity party"],
  Senegal: ["senegal", "dakar", "bassirou diomaye", "diomaye faye", "ousmane sonko", "sonko", "amadou ba", "macky sall", "pastef", "cena"],
  Ghana: ["ghana", "accra", "mahama", "bawumia", "npp", "ndc", "electoral commission"],
  Guinea: ["guinea", "guinée", "conakry", "doumbouya", "ceni", "referendum", "référendum", "cellou dalein"],
  "Cote d'Ivoire": ["cote d'ivoire", "côte d'ivoire", "ivory coast", "abidjan", "ouattara", "rhdp", "gbagbo", "tidjane thiam", "cei"],
  "Guinée Bissau": ["guinea-bissau", "guinea bissau", "guinée bissau", "guinée-bissau", "bissau", "embaló", "embalo", "coup"],
  Benin: ["benin", "bénin", "cotonou", "porto-novo", "talon", "cena benin", "wadagni"],
};
const ELECTION_KW = ["election", "élection", "vote", "voter", "ballot", "poll", "candidate", "run-off", "runoff", "parliament", "presidential", "legislative", "by-election", "referendum"];

const ELECTIONS = [
  { year: 2023, date: "2023-02-25", country: "Nigeria", type: "Presidential" },
  { year: 2023, date: "2023-06-24", country: "Sierra Leone", type: "Presidential" },
  { year: 2023, date: "2023-10-10", country: "Liberia", type: "Presidential" },
  { year: 2023, date: "2023-11-14", country: "Liberia", type: "Presidential Run-off", firstRound: "2023-10-10" },
  { year: 2024, date: "2024-03-24", country: "Senegal", type: "Presidential" },
  { year: 2024, date: "2024-11-17", country: "Senegal", type: "Parliamentary" },
  { year: 2024, date: "2024-12-07", country: "Ghana", type: "Presidential and Parliamentary", site: GHANA },
  { year: 2025, date: "2025-04-22", country: "Liberia", type: "Nimba County Senate By-election" },
  { year: 2025, date: "2025-09-21", country: "Guinea", type: "Referendum" },
  { year: 2025, date: "2025-10-25", country: "Cote d'Ivoire", type: "Presidential" },
  { year: 2025, date: "2025-11-23", country: "Guinée Bissau", type: "Presidential (suspended - attempted coup)" },
  { year: 2025, date: "2025-12-27", country: "Cote d'Ivoire", type: "Parliamentary" },
  { year: 2025, date: "2025-12-28", country: "Guinea", type: "Presidential" },
  { year: 2026, date: "2026-01-11", country: "Benin", type: "Parliamentary" },
  { year: 2026, date: "2026-04-12", country: "Benin", type: "Presidential" },
  { year: 2026, date: "2026-05-31", country: "Guinea", type: "Parliamentary" },
];

const CAT_PARENT = 3136; // "Countries" parent term on dubawa.org

// ---------- helpers ----------
const norm = (x = "") => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const decode = (x = "") => x
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
  .trim();
const shift = (d, days) => new Date(new Date(d).getTime() + days * 864e5).toISOString().slice(0, 19);
const strip = (html = "") => html.replace(/<[^>]+>/g, " ").replace(/&[#\w]+;/g, " ").toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "dubawa-election-pull/1.0" } });
      if (res.status === 400) return { data: [], pages: 0 }; // page past end
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return { data: await res.json(), pages: +res.headers.get("X-WP-TotalPages") || 1 };
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

async function pullAll(site, endpoint, params) {
  const all = [];
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ ...params, per_page: "100", page: String(page),
      _fields: "id,date,modified,link,slug,type,title,excerpt,content,categories,tags" });
    const { data, pages } = await getJSON(`${site}/wp-json/wp/v2/${endpoint}?${qs}`);
    all.push(...data);
    if (page >= pages || !data.length) break;
    await sleep(300);
  }
  return all;
}

// WP only exposes `viewable` in the "edit" context (i.e. to an authenticated
// request). Unauthenticated it is absent on every type, so we fall back to
// probing each candidate collection for public readability and dropping the
// core/plugin infrastructure types that are not front-end content.
const INTERNAL = new Set(["menu-items", "blocks", "templates", "template-parts",
  "global-styles", "navigation", "font-families", "feedback", "jetpack-forms",
  "activity-log-events", "jp_pay_order", "jp_pay_product", "rm_content_editor",
  "rank_math_schema"]);

async function postTypes(site) {
  const { data } = await getJSON(`${site}/wp-json/wp/v2/types`);
  const all = Object.values(data);
  const candidates = all.filter((t) =>
    t.rest_base &&
    !/[()\\]/.test(t.rest_base) &&
    !["pages", "media"].includes(t.rest_base));

  // authenticated response: trust `viewable` directly
  if (all.some((t) => t.viewable !== undefined)) {
    return candidates.filter((t) => t.viewable === true).map((t) => t.rest_base);
  }

  // unauthenticated: keep types that are publicly readable and hold content
  const out = [];
  for (const t of candidates) {
    if (INTERNAL.has(t.rest_base)) continue;
    const res = await fetch(`${site}/wp-json/wp/v2/${t.rest_base}?per_page=1&_fields=id,link`,
      { headers: { "User-Agent": "dubawa-election-pull/1.0" } });
    if (!res.ok) continue;
    const items = await res.json();
    if (Array.isArray(items) && items[0]?.link) out.push(t.rest_base);
  }
  return out;
}

async function allCategories(site) {
  const map = new Map();
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ per_page: "100", page: String(page), _fields: "id,name,parent" });
    const { data, pages } = await getJSON(`${site}/wp-json/wp/v2/categories?${qs}`);
    for (const c of data) map.set(c.id, { name: decode(c.name), parent: c.parent });
    if (page >= pages || !data.length) break;
    await sleep(200);
  }
  return map;
}

// content_type is a positive allowlist of editorial categories, matched by name
// (the two sites use different ids for the same term).
const EDITORIAL = [
  "Fact Check", "Explainers", "Analysis", "News", "Live Updates", "Media Literacy",
  "Article", "Facebook Checks", "Quick Checks", "Live fact-check",
  "Special Reports", "Research", "Press Releases",
];
const EDITORIAL_SET = new Set(EDITORIAL.map(norm));

// election-desk categories, found by name so each site keeps its own ids
function electionCats(cats) {
  const hits = [...cats].filter(([, c]) => /^elections?$|election\s*news/i.test(c.name));
  return { ids: new Set(hits.map(([id]) => id)), label: hits.map(([id, c]) => `${id}:${c.name}`).join(", ") };
}

const COUNTRY_CAT_IDS = new Set(Object.values(CAT).filter(Boolean));
const COUNTRY_WORDS = Object.keys(KW).map(norm);

// A category is "country-related" if it is the Countries parent, one of its
// children, an id we already map to a country, or simply named after one.
function isCountryCat(id, c) {
  if (id === CAT_PARENT || c.parent === CAT_PARENT || COUNTRY_CAT_IDS.has(id)) return true;
  const n = norm(c.name);
  return COUNTRY_WORDS.some((w) => n.includes(w) || w.includes(n));
}

// names of every category, plus the editorial ones (Fact Check, Explainers, ...)
function catFields(ids = [], cats) {
  const names = [], types = [];
  for (const id of ids) {
    const c = cats.get(id);
    if (!c) continue;
    names.push(c.name);
    if (EDITORIAL_SET.has(norm(c.name))) types.push(c.name);
  }
  return { category_names: names.join(" | "), content_type: types.join(" | ") };
}

const hasCountryCat = (ids = [], cats) =>
  ids.some((id) => { const c = cats.get(id); return c && isCountryCat(id, c); });

function score(post, election, electionCatIds) {
  const reasons = [];
  let s = 0;
  const cat = CAT[election.country];
  const inCat = !!(cat && post.categories?.includes(cat));
  if (inCat) { s += 3; reasons.push(`category:${cat}`); }
  const inElectionsCat = (post.categories || []).some((id) => electionCatIds.has(id));
  if (inElectionsCat) { s += 3; reasons.push("elections-cat"); }
  const title = strip(post.title?.rendered) + " " + post.slug;
  const body = strip(post.content?.rendered) + " " + strip(post.excerpt?.rendered);
  let countryTitle = false, countryBody = false;
  for (const k of KW[election.country]) {
    if (title.includes(k)) { s += 2; countryTitle = true; reasons.push(`title:${k}`); }
    else if (body.includes(k)) { s += 1; countryBody = true; reasons.push(`body:${k}`); }
  }
  const elTitle = ELECTION_KW.filter((k) => title.includes(k));
  const elBody = ELECTION_KW.filter((k) => body.includes(k));
  const el = [...new Set([...elTitle, ...elBody])];
  if (el.length) { s += 1; reasons.push(`election:${el.slice(0, 3).join("|")}`); }
  return {
    score: s, reasons: reasons.join("; "), inCat, inElectionsCat,
    countryTitle, countryBody,
    elTitle: elTitle.length > 0, elBody: elBody.length > 0,
  };
}

// ---------- main ----------
mkdirSync("out/manifest", { recursive: true });
const master = [], review = [];
const typeCache = {};
const catCache = {};

// id -> {name, parent} per site (Ghana is a separate install with its own ids)
const catNames = {};
const electionCatIds = {};
for (const site of [...new Set(ELECTIONS.map((e) => e.site || MAIN))]) {
  catNames[site] = await allCategories(site);
  electionCatIds[site] = electionCats(catNames[site]);
  console.log(`categories @ ${site}: ${catNames[site].size} | election categories: ${electionCatIds[site].label || "(none)"}`);
}

for (const e of ELECTIONS) {
  const site = e.site || MAIN;
  if (!typeCache[site]) {
    typeCache[site] = await postTypes(site);
    console.log(`types @ ${site}: ${typeCache[site].join(", ") || "(none)"}`);
  }
  const key = `${e.date}_${e.country.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\W+/g, "-")}`;
  const seen = new Map();

  for (const t of typeCache[site]) {
    // 1. wide pull: everything in the window, no keyword filter
    const win = await pullAll(site, t, { after: shift(e.date, -DAYS_BEFORE), before: shift(e.date, DAYS_AFTER), status: "publish" });
    win.forEach((p) => seen.set(p.id, { ...p, _from: "window" }));

    // 2. straggler pull: whole country category, date-unbounded
    const cat = CAT[e.country];
    if (cat && site === MAIN) {
      // same country appears in several elections - pull each category once
      const ck = `${site}|${t}|${cat}`;
      catCache[ck] ??= await pullAll(site, t, { categories: String(cat), status: "publish" });
      const all = catCache[ck];
      all.forEach((p) => { if (!seen.has(p.id)) seen.set(p.id, { ...p, _from: "category-only" }); });
    }
  }

  const scored = [...seen.values()].map((p) => {
    const { score: sc, reasons, inCat, inElectionsCat, countryTitle, countryBody, elTitle, elBody } =
      score(p, e, electionCatIds[site].ids);
    const otherCountryCat = hasCountryCat(p.categories, catNames[site]);
    const postDate = p.date.slice(0, 10);
    const days = Math.round((Date.parse(postDate) - Date.parse(e.date)) / 864e5);
    const near = Math.abs(days) <= CAT_ONLY_DAYS;
    const gate = [
      p._from,
      inCat ? "cat" : null,
      inElectionsCat ? "elections_cat" : null,
      countryTitle ? "country_title" : countryBody ? "country_body" : null,
      elTitle ? "title_kw" : elBody ? "body_kw" : null,
      near ? `within_${CAT_ONLY_DAYS}` : null,
      sc >= 3 ? "score_ok" : null,
      CAT[e.country] ? null : "no_cat_id",
    ].filter(Boolean).join("|");
    const { category_names, content_type } = catFields(p.categories, catNames[site]);
    const row = {
      election_year: e.year, election_date: e.date, country: e.country, election_type: e.type,
      post_id: p.id, post_type: p.type, post_date: postDate, modified: p.modified.slice(0, 10),
      days_from_election: days,
      title: strip(p.title?.rendered).trim(), url: p.link, categories: (p.categories || []).join("|"),
      category_names, content_type,
      source: p._from, gate, match_score: sc, match_reasons: reasons,
    };
    // category-only hits are date-unbounded, so category membership alone is not
    // enough: they must sit near the vote and name an election term up front.
    // Countries with no category id have no country category to lean on, so they
    // need the election term up front - or an Elections-desk filing that is not
    // claimed by some other country's category.
    const isConfirmed = p._from === "category-only"
      ? (near && elTitle)
      : sc >= 3 && (CAT[e.country] ? true : elTitle || (inElectionsCat && !otherCountryCat));
    return { row, isConfirmed };
  });

  const rows = scored.map((x) => x.row);
  const confirmed = scored.filter((x) => x.isConfirmed).map((x) => x.row);
  const maybe = scored.filter((x) => !x.isConfirmed && x.row.match_score > 0).map((x) => x.row);
  master.push(...confirmed);
  review.push(...maybe);
  writeFileSync(`out/manifest/${key}.json`, JSON.stringify({ election: e, pulled: rows.length, confirmed: confirmed.length, review: maybe.length, rows }, null, 2));
  const noType = confirmed.filter((r) => !r.content_type).length;
  console.log(`${e.date} ${e.country.padEnd(14)} ${e.type.padEnd(35)} pulled=${rows.length} confirmed=${confirmed.length} review=${maybe.length} no_content_type=${noType}`);
}

// ---------- dedupe: one row per post_id, kept for the nearest election ----------
const ekey = (date, country) => `${date}_${country}`;
// run-off election key -> its first round
const RUNOFFS = ELECTIONS.filter((e) => e.firstRound)
  .map((e) => ({ runoff: ekey(e.date, e.country), first: ekey(e.firstRound, e.country), firstRound: e.firstRound }));

function pickElection(cands) {
  // a post confirmed for both a first round and its run-off belongs to whichever
  // vote it was published after; only then fall back to the nearest election
  for (const ro of RUNOFFS) {
    const a = cands.find((r) => ekey(r.election_date, r.country) === ro.runoff);
    const b = cands.find((r) => ekey(r.election_date, r.country) === ro.first);
    if (a && b) {
      const drop = a.post_date > ro.firstRound ? b : a;
      cands = cands.filter((r) => r !== drop);
    }
  }
  return cands.reduce((best, r) =>
    !best || Math.abs(r.days_from_election) < Math.abs(best.days_from_election) ? r : best, null);
}

function dedupe(rows) {
  const byPost = new Map();
  for (const r of rows) {
    if (!byPost.has(r.post_id)) byPost.set(r.post_id, []);
    byPost.get(r.post_id).push(r);
  }
  const kept = new Set([...byPost.values()].map(pickElection));
  const dropped = {};
  for (const r of rows) {
    if (kept.has(r)) continue;
    const k = `${r.election_date}_${r.country}`;
    dropped[k] = (dropped[k] || 0) + 1;
  }
  return { rows: rows.filter((r) => kept.has(r)), dropped };
}

const dedupedMaster = dedupe(master);
const dedupedReview = dedupe(review);

console.log("\nduplicates dropped (post kept for the election it is nearest to):");
for (const e of ELECTIONS) {
  const k = `${e.date}_${e.country}`;
  console.log(`${e.date} ${e.country.padEnd(14)} master -${dedupedMaster.dropped[k] || 0} review -${dedupedReview.dropped[k] || 0}`);
}

const cols = Object.keys(dedupedMaster.rows[0] || dedupedReview.rows[0] || {});
const toCSV = (rows) => [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
writeFileSync("out/master.csv", toCSV(dedupedMaster.rows));
writeFileSync("out/review.csv", toCSV(dedupedReview.rows));
console.log(`\nmaster.csv: ${dedupedMaster.rows.length} rows (${master.length} before dedupe) | review.csv: ${dedupedReview.rows.length} rows (${review.length} before dedupe)`);

// ---------- summary.csv: confirmed per election, broken down by content type ----------
const present = new Set();
for (const r of dedupedMaster.rows) for (const t of (r.content_type ? r.content_type.split(" | ") : [])) present.add(t);
const typeCols = [...EDITORIAL.filter((t) => present.has(t)), ...[...present].filter((t) => !EDITORIAL.includes(t)).sort()];

const summaryRow = (label, rows) => {
  const row = { election_date: label.date, country: label.country, election_type: label.type, confirmed: rows.length };
  for (const t of typeCols) row[t] = rows.filter((r) => r.content_type.split(" | ").includes(t)).length;
  row.no_content_type = rows.filter((r) => !r.content_type).length;
  return row;
};

const summary = ELECTIONS.map((e) => summaryRow({ date: e.date, country: e.country, type: e.type },
  dedupedMaster.rows.filter((r) => r.election_date === e.date && r.country === e.country)));
summary.push(summaryRow({ date: "TOTAL", country: "", type: "" }, dedupedMaster.rows));

const sumCols = Object.keys(summary[0]);
writeFileSync("out/summary.csv",
  [sumCols.join(","), ...summary.map((r) => sumCols.map((c) => csvCell(r[c])).join(","))].join("\n"));
console.log(`summary.csv: ${summary.length} rows x ${sumCols.length} cols`);
