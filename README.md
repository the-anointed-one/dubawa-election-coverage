# DUBAWA Election Coverage, 2023–2026

Structured data on DUBAWA's coverage of **16 West African elections** between February 2023 and May 2026, collected from DUBAWA's own public WordPress REST API.

**Data scraped 7 September 2026.**

| File | Contents |
| --- | --- |
| `dubawa-elections.mjs` | The collection and classification script (Node 18+, no dependencies) |
| `out/master.csv` | 782 confirmed posts, one row per post |
| `out/review.csv` | 1,700 borderline posts that scored above zero but failed their threshold |
| `out/summary.csv` | One row per election: confirmed count broken down by content type, plus a totals row |
| `out/manifest/*.json` | Per-election records, **before** deduplication, with every post's score and reasons |
| `out/run.log` | Console output of the run: detected post types, categories and per-election counts |

Reproduce with `node dubawa-elections.mjs` (writes to `out/`). Re-running fetches live data, so counts will drift as the sites publish.

## Elections covered

Nigeria 2023-02-25 · Sierra Leone 2023-06-24 · Liberia 2023-10-10 and run-off 2023-11-14 · Senegal 2024-03-24 and 2024-11-17 · Ghana 2024-12-07 · Liberia (Nimba by-election) 2025-04-22 · Guinea 2025-09-21, 2025-12-28 and 2026-05-31 · Côte d'Ivoire 2025-10-25 and 2025-12-27 · Guinée Bissau 2025-11-23 · Benin 2026-01-11 and 2026-04-12

## Scraping

The script does not parse HTML. It reads the sites' own REST API — `https://dubawa.org/wp-json/wp/v2/` and, for Ghana coverage, the separate installation at `https://ghana.dubawa.org/wp-json/wp/v2/` — requesting only `status=publish` posts, 100 per page, with a 300 ms pause between pages, three retries with backoff, and an identifying User-Agent (`dubawa-election-pull/1.0`).

For each election it makes two passes:

1. **Window pull** — everything published from 42 days before to 28 days after polling day, with no keyword filter.
2. **Straggler pull** — the country's entire category, date-unbounded, fetched once per country and reused across that country's elections.

Post types are restricted to publicly viewable front-end types, which resolves to `posts` on both sites.

## Classification

Every retrieved post is scored:

| Signal | Points |
| --- | --- |
| Country category membership | +3 |
| "Elections" desk category | +3 |
| Country keyword in title or slug | +2 |
| Country keyword in body only | +1 |
| Any election term (election, ballot, run-off, referendum, …) | +1 |

Confirmation thresholds vary by how the post was found, because the two pulls carry different evidential weight:

- **Window posts** need a score of 3.
- **Nigeria and Ghana** have no country category on their site, so their posts additionally need an election term in the headline **or** an Elections-desk filing not claimed by another country's category.
- **Category-only stragglers**, being date-unbounded, need to fall within 180 days of the vote **and** name an election term in the title or slug.

Anything scoring above zero but failing its threshold goes to `review.csv` rather than being discarded.

Posts are then deduplicated to one row per post per file and assigned to the election they are closest to in time — except across Liberia's 2023 first round and run-off, only 35 days apart, where a post is assigned by whether it was published before or after 10 October, since proximity alone splits run-off coverage arbitrarily.

## Disaggregation

Category IDs are resolved to names **per site**: the two installations reuse IDs for different terms, so IDs are not comparable across them and grouping must be done by name.

`content_type` is derived from a **positive allowlist** of editorial categories: Fact Check, Explainers, Analysis, News, Live Updates, Media Literacy, Article, Facebook Checks, Quick Checks, Live fact-check, Special Reports, Research, Press Releases. An exclusion-based approach was tried first and abandoned, because it let placement flags (`Homepage`, `Headline`, `Featured`) and topic tags (`Politics`, `Elections`) through as if they were content types. `Elections` is used as a relevance signal but deliberately not as a content type.

## Auditability

Every row carries a `gate` column recording which conditions it met — `window`, `cat`, `elections_cat`, `country_title`, `title_kw`, `within_180`, `score_ok`, `no_cat_id` — alongside `match_score` and `match_reasons`. Any inclusion can be traced to its evidence rather than taken on trust. The per-election manifests retain the undeduplicated rows.

## Known limitations

- **91 of 782 confirmed posts carry no editorial category**, 73 of them tagged only with a country. These concentrate in the francophone desks — Senegal 42, République de Guinée 15, Bénin 10, Guinée Bissau 4. This is a tagging gap on the source sites, not a classification failure, and no French-language editorial categories exist to add.
- **Senegal's two 2024 elections differ sharply in tagging** — 1 Fact Check from 32 confirmed in March, 17 from 31 in November. Type comparisons across that boundary are unsafe.
- **"Live Updates" (main site) and "Live fact-check" (Ghana)** are the same editorial format under two names and are counted in separate columns.
- **Benin 2026-04-12** yields 10 confirmed posts, all untyped and country-only; it is the one election with no fact-checks at all.
- Keyword lists are hand-built, so recall depends on them, as well as on the ±42/28-day window and the 180-day straggler cap.
- All results come from unauthenticated requests, so unpublished, private or draft content is out of scope by construction.
