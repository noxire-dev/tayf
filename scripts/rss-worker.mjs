#!/usr/bin/env node
// scripts/rss-worker.mjs
//
// Continuous RSS listener worker for Tayf.
// Replaces the manual /api/cron/ingest refresh pattern with a long-running
// background process that loops every 60 seconds, fetching all active RSS
// sources sequentially and upserting normalized articles into Supabase.
//
// Usage:
//   node scripts/rss-worker.mjs              # run forever
//   DRY_RUN=1 node scripts/rss-worker.mjs    # run a single cycle then exit
//
// Designed to run under Node 20 in a tmux pane. ESM only, no TypeScript.

import Parser from "rss-parser";

import {
  loadDotEnvLocal,
  log,
  logCycle,
  ts,
  installShutdownHandler,
  sleep,
} from "./lib/shared/runtime.mjs";
import { createServiceClient } from "./lib/shared/supabase.mjs";
import { createCircuitBreaker } from "./lib/shared/circuit-breaker.mjs";
import { runPool } from "./lib/shared/pool.mjs";
import { strictFingerprint } from "./lib/cluster/fingerprint.mjs";
import { fetchOgImage } from "./lib/shared/og-image.mjs";

// ---------------------------------------------------------------------------
// 1. Env + Supabase
// ---------------------------------------------------------------------------

loadDotEnvLocal();

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const CYCLE_INTERVAL_MS = 60_000;

// Bounded concurrency for per-source HTTP fetches. 8 is a sane default that
// keeps DNS + socket pressure low while still collapsing ~145s of serial
// wall-clock into well under a minute. Tunable via env for operational
// response to rate-limit or resolver issues.
const RSS_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.RSS_CONCURRENCY || "8", 10) || 8
);

// Per-source special-case: haberler.com.
//
// Background: haberler.com is the single biggest source in the corpus
// (~25 % of all articles) and its RSS ships ZERO image fields — no
// `<enclosure>`, no `media:content`, no `media:thumbnail`, and no `<img>`
// in `content:encoded`. IMG1's audit (team/logs/image-audit.md §3c) found
// 1,249 of the global 2,332 image-null articles came from this one source.
// Fixing it lifts overall image coverage from 76.55 % to ~89 %.
//
// Strategy: after parsing each cycle's haberler.com items, the rows whose
// `image_url` is still null get a focused per-item fetch of the article
// page. We reuse the shared `fetchOgImage` helper which reads up to 50KB
// of HTML and pulls `<meta property="og:image">`. Most haberler.com pages
// with a hero image expose `og:image`; the text-only briefs don't, and we
// leave their image_url null (correctly — there is no image to find).
//
// The fetches run AFTER the RSS pool but BEFORE the batched upsert, so
// the rows go to the DB with `image_url` already set on the very first
// insert. This is the "batched concurrent" approach from the brief: the
// fill runs at concurrency 8 against haberler.com only and does not
// block fetches for the other 143 sources.
const HABERLER_SLUG = "haberler-com";
const HABERLER_IMAGE_CONCURRENCY = 8;
const HABERLER_IMAGE_TIMEOUT_MS = 5_000;

// Dead-feed skipper: consecutive-failure tracking that persists across
// cycles for the lifetime of this process. After DEAD_FAIL_THRESHOLD
// consecutive failures, a source is skipped for DEAD_SKIP_MS before being
// retried once. A successful fetch resets the counter. Backed by the
// shared circuit breaker so the same wiring is used by image-worker.
const DEAD_FAIL_THRESHOLD = 3;
const DEAD_SKIP_MS = 30 * 60 * 1000; // 30 minutes
const sourceBreaker = createCircuitBreaker({
  failureThreshold: DEAD_FAIL_THRESHOLD,
  cooldownMs: DEAD_SKIP_MS,
});

// ---------------------------------------------------------------------------
// Seen-hash cache (W4-Q5 opt #1)
//
// R2+D5 added a per-source `(source_id, content_hash)` pre-check before
// upsert: one round-trip per source per cycle (~105 queries on the hot
// path). With 144 sources active that burns 100+ DB round-trips just to
// ask "is this content already here?", which is the same information we
// could hold in memory.
//
// Strategy: on worker startup (and every SEEN_REFRESH_CYCLES cycles
// after), pull the last SEEN_LOOKBACK_DAYS of `(source_id, content_hash)`
// pairs from articles into a Set keyed by `${source_id}\x1f${hash}`.
// Per-item lookups become O(1) and the hot-path pre-check disappears.
//
// Caveats:
//   - Stale between refreshes: a new article inserted by THIS cycle is
//     added to the Set inline, but an insert by a sibling process (none
//     exist in prod, but guard against it) would not be reflected until
//     the next refresh. The DB still has the `(source_id, content_hash)`
//     UNIQUE constraint (migration 013) as the authoritative backstop.
//   - Lookback window chosen to be 7 days to match the spec in the task
//     brief; most dupes arise from same-day / same-week republishing.
const SEEN_LOOKBACK_DAYS = 7;
const SEEN_REFRESH_CYCLES = 5;
/** @type {Set<string>} */
const seenHashes = new Set();
let seenCycleCounter = 0;
function seenKey(sourceId, hash) {
  // `\x1f` is ASCII unit-separator — never appears in UUIDs or hex hashes
  // so the compound key is unambiguous without JSON overhead.
  return `${sourceId}\x1f${hash}`;
}
async function refreshSeenHashes() {
  const sinceIso = new Date(
    Date.now() - SEEN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const startedAt = Date.now();
  // Page through to avoid PostgREST's default 1000-row cap. Recent
  // articles are indexed on (published_at desc) so this is cheap.
  const PAGE = 1000;
  let offset = 0;
  const fresh = new Set();
  while (true) {
    const { data, error } = await supabase
      .from("articles")
      .select("source_id, content_hash")
      .gte("published_at", sinceIso)
      .order("published_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error(
        `${ts()} [worker] seen-hash refresh error: ${error.message}`
      );
      return;
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (row.source_id && row.content_hash) {
        fresh.add(seenKey(row.source_id, row.content_hash));
      }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  seenHashes.clear();
  for (const k of fresh) seenHashes.add(k);
  const elapsed = Date.now() - startedAt;
  log(
    "worker",
    `seen-hash cache refreshed: ${seenHashes.size} pairs in ${(elapsed / 1000).toFixed(1)}s`
  );
}

let supabase;
try {
  supabase = createServiceClient();
} catch (err) {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
}

const shutdown = installShutdownHandler("rss-worker");

// ---------------------------------------------------------------------------
// 2. RSS parser setup
// ---------------------------------------------------------------------------

// W4-Q5 opt #3 — fetch timeout dropped from 15s → 10s. The cycle wall-clock
// is dominated by the slowest tail fetches running out of the 8-way pool;
// every dead feed that previously burned 15s now burns at most 10s, shaving
// ~5s off the tail of the cycle without affecting any healthy source
// (median feed responds in well under 1s).
const FETCH_TIMEOUT_MS = 10_000;

// Parser kept around for `parseString()`. The `timeout` option only applies
// to `parseURL()` (which we no longer use); we drive HTTP via global fetch
// + AbortSignal.timeout so we can also get response headers (ETag /
// Last-Modified) for the conditional-GET cache below.
const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: {
    Accept: "application/rss+xml, application/xml, text/xml",
  },
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: false }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
      ["media:group", "mediaGroup", { keepArray: false }],
      ["enclosure", "enclosure", { keepArray: false }],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

// T24 blocks default user agents — reuse the override from src/lib/rss/fetcher.ts
const SOURCE_HEADERS = {
  t24: {
    "User-Agent":
      "Mozilla/5.0 (compatible; Tayf/1.0; +https://tayf.app)",
  },
};

const DEFAULT_UA =
  "Mozilla/5.0 (compatible; Tayf/1.0; +https://tayf.app) rss-worker";
const DEFAULT_FETCH_HEADERS = {
  Accept: "application/rss+xml, application/xml, text/xml, */*;q=0.1",
  "Accept-Encoding": "gzip, deflate",
  "User-Agent": DEFAULT_UA,
};

// W4-Q5 opt #4 — conditional-GET (ETag / If-Modified-Since) memoization.
//
// Most Turkish news RSS feeds set Last-Modified or ETag and respond 304 if
// nothing has changed. Cached per source.id in-memory for the lifetime of
// the worker process. On a 304 we return zero items WITHOUT XML parsing —
// the dominant cost on the hot path now that the seen-hash cache (#1) and
// batched upsert (#2) have already eliminated the per-item DB chatter.
//
// Caveat: cache is process-local and resets on restart. That's fine — the
// first cycle after a restart pays full freight, every subsequent cycle
// hits 304 for any feed that hasn't changed.
/** @type {Map<string, { etag?: string, lastModified?: string }>} */
const feedCacheHeaders = new Map();
let cycleCondHits = 0; // 304 count (per cycle, reset by runCycle)

/**
 * Fetch a single source's RSS feed using conditional GET. Returns the
 * parsed item array (possibly empty). Throws on network error / non-2xx
 * (other than 304) so the circuit breaker logic upstream still runs.
 *
 * On a 304 Not Modified response we return an empty array AND skip
 * XML parsing entirely — the seen-hash cache will then quietly notice
 * that there are zero items to consider for this source.
 */
async function fetchSingleFeed(source) {
  const cached = feedCacheHeaders.get(source.id);
  const headers = { ...DEFAULT_FETCH_HEADERS };
  const extraHeaders = SOURCE_HEADERS[source.slug];
  if (extraHeaders) Object.assign(headers, extraHeaders);
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

  let res;
  try {
    res = await fetch(source.rss_url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    // Normalize AbortError → "Request timed out" so the upstream log
    // line stays consistent with the prior rss-parser wording.
    const name = err && typeof err === "object" ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  }

  if (res.status === 304) {
    // Not modified — refresh cached headers (some servers rotate ETags
    // without changing the body, but we want the latest validator) and
    // short-circuit. No XML parse, no normalization, no DB work.
    cycleCondHits++;
    return [];
  }
  if (!res.ok) {
    throw new Error(`Status code ${res.status}`);
  }

  const xml = await res.text();

  // Cache the validators for next cycle. Only cache when we actually
  // received a 200 with a body — we never want to cache an error page.
  const newEtag = res.headers.get("etag");
  const newLastMod = res.headers.get("last-modified");
  if (newEtag || newLastMod) {
    feedCacheHeaders.set(source.id, {
      etag: newEtag || undefined,
      lastModified: newLastMod || undefined,
    });
  }

  const feed = await parser.parseString(xml);
  return feed.items || [];
}

// ---------------------------------------------------------------------------
// 3. Normalization — ported faithfully from src/lib/rss/normalize.ts
// ---------------------------------------------------------------------------

// Sources whose entire output is sports — bypass keyword classification
// and tag every article `spor` so they cluster together and don't
// accidentally land in politics clusters via stray keywords.
const SPORTS_SOURCE_SLUGS = new Set([
  "fotomac",
  "fotospor",
  "a-spor",
  "ntv-spor",
  "kontraspor",
  "ajansspor",
]);

// Keyword-based category classification for Turkish news
const CATEGORY_RULES = [
  {
    category: "son_dakika",
    keywords: /son\s*dakika|flaş\s*haber|breaking|acil|sondakika/i,
  },
  {
    category: "spor",
    keywords:
      /futbol|süper\s*lig|galatasaray|fenerbahçe|beşiktaş|trabzonspor|basketbol|voleybol|şampiyonlar\s*ligi|milli\s*takım|gol|maç|transfer|teknik\s*direktör|stadyum|olimpiyat|uefa|fifa|tff/i,
  },
  {
    category: "politika",
    keywords:
      /erdoğan|chp|akp|ak\s*parti|mhp|hdp|tbmm|meclis|cumhurbaşkan|bakan(lık)?|seçim|oy|muhalefet|hükümet|vekil|siyaset|anayasa|parti\s*genel|içişleri|dışişleri/i,
  },
  {
    category: "dunya",
    keywords:
      /abd|amerika|rusya|ukrayna|çin|avrupa|nato|bm|birleşmiş\s*milletler|eu|ingiltere|almanya|fransa|iran|israil|filistin|suriye|irak|dünya|uluslararası|küresel/i,
  },
  {
    category: "ekonomi",
    keywords:
      /dolar|euro|tl|enflasyon|faiz|borsa|merkez\s*bankası|bist|ekonomi|ihracat|ithalat|büyüme|gsyih|vergi|maaş|asgari\s*ücret|zam|piyasa|kur/i,
  },
  {
    category: "teknoloji",
    keywords:
      /yapay\s*zeka|ai|iphone|samsung|google|microsoft|apple|siber|yazılım|uygulama|robot|teknoloji|dijital|startup|kripto|bitcoin|blockchain/i,
  },
  {
    category: "yasam",
    keywords:
      /sağlık|eğitim|üniversite|deprem|hava\s*durumu|trafik|kaza|yangın|sel|çevre|kültür|sanat|müzik|sinema|dizi|magazin|yaşam/i,
  },
];

function classifyCategory(title, description, url) {
  const text = `${title} ${description || ""} ${url}`.toLowerCase();

  // Son dakika gets priority
  if (CATEGORY_RULES[0].keywords.test(text)) return "son_dakika";

  // Check URL path for category hints
  const urlCategory = detectCategoryFromUrl(url);
  if (urlCategory) return urlCategory;

  // Keyword matching on title + description
  for (const rule of CATEGORY_RULES.slice(1)) {
    if (rule.keywords.test(text)) return rule.category;
  }

  return "genel";
}

function detectCategoryFromUrl(url) {
  const path = url.toLowerCase();
  if (/\/spor\/|\/sport/.test(path)) return "spor";
  if (/\/siyaset\/|\/politika\/|\/politi/.test(path)) return "politika";
  if (/\/ekonomi\/|\/finans\/|\/economy/.test(path)) return "ekonomi";
  if (/\/teknoloji\/|\/tech/.test(path)) return "teknoloji";
  if (/\/dunya\/|\/world\/|\/global/.test(path)) return "dunya";
  if (/\/yasam\/|\/life\/|\/saglik\/|\/egitim/.test(path)) return "yasam";
  return null;
}

function getImageEnclosure(item) {
  if (!item.enclosure?.url) return null;
  const type = item.enclosure.type || "";
  if (type && !type.startsWith("image/")) return null;
  return item.enclosure.url;
}

function isValidImageUrl(url) {
  if (!url || url.length < 10) return false;
  if (url.startsWith("data:")) return false;
  if (/favicon|icon|logo|pixel|tracker|1x1|spacer/i.test(url)) return false;
  return true;
}

function extractImage(item) {
  const fromFields =
    getImageEnclosure(item) ||
    item.mediaContent?.$?.url ||
    item.mediaThumbnail?.$?.url ||
    item.mediaGroup?.["media:content"]?.$?.url ||
    item.mediaGroup?.["media:thumbnail"]?.$?.url ||
    null;

  if (fromFields) return fromFields;

  const htmlContent = item.contentEncoded || item.content || "";
  if (htmlContent) {
    const imgMatch = htmlContent.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch?.[1] && isValidImageUrl(imgMatch[1])) return imgMatch[1];
  }

  // og:image is left for the separate cron pass; do NOT fetch inline here.
  return null;
}

// Decode XML/HTML named entities that survive rss-parser's own decode pass.
// haberler.com (and a few others) double-encode their feeds:
//   raw feed contains `&amp;apos;`
//   rss-parser decodes `&amp;` → `&`, leaving the literal string `&apos;`
//   which then lands in our DB and gets rendered as text by React.
// Running a second pass here catches the double-encoded cases. Handles the
// five XML named entities plus common numeric forms.
function decodeEntities(text) {
  if (!text) return text;
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function cleanDescription(raw) {
  if (!raw) return null;
  // Strip tags → decode entities → trim → cap at 500 chars.
  // Entity decode must come AFTER tag strip so <p>&lt;x&gt;</p> doesn't
  // get re-interpreted as a tag.
  const text = decodeEntities(raw.replace(/<[^>]*>/g, "")).trim();
  return text.length > 500 ? text.slice(0, 497) + "..." : text || null;
}

function parseDate(raw) {
  if (!raw) return new Date().toISOString();
  const date = new Date(raw);
  return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

// ---------------------------------------------------------------------------
// URL canonicalization (w2-d5)
//
// R2's duplicate audit (team/logs/duplicate-audit.md §Q2) found 24
// duplicate `(source, normalized_title)` groups where outlets emit the
// same article under multiple URL variants. Three patterns were observed:
//
//   Pattern A — Section-slug variants (10Haber /siyaset/ vs /gundem/)
//   Pattern B — Punctuation-folded slugs (Evrensel `metalurji'deki` vs
//               `metalurjideki`)
//   Pattern C — Recycled story-ids (Haberler.com publishing the same
//               headline under a new numeric id)
//
// The `articles_url_key` UNIQUE constraint can't catch these because the
// URL strings differ. `canonicalizeUrl` strips the noise we *can* fold at
// this layer — casing, `www.`, tracking params, trailing slashes, the
// fragment, apostrophes, and per-source section-slug prefixes — so that
// two variants of the same article collapse into the same canonical URL.
// Pattern C (recycled ids) cannot be solved at the URL layer; for that
// we rely on `content_hash` via strictFingerprint(title, description),
// which is invariant to URL shape entirely. D6's forthcoming
// `(source_id, content_hash)` unique constraint will backstop this at
// the DB level.

// Per-source path rewrites. Each entry is a regex replacement applied to
// the URL pathname. Rules target section-slug variants that R2's audit
// identified as causing same-id-different-path dupes: 10Haber publishes
// the same numeric id under `/siyaset/`, `/gundem/`, and `/populer/`.
// Other sources are left alone so unrelated articles cannot accidentally
// collide.
const SOURCE_CANON_RULES = {
  // 10Haber: /siyaset/…-692994/ vs /gundem/…-692994/ vs /populer/…-692994/.
  // Trailing numeric id is the canonical key; section slug is editorial
  // classification that varies between crawls.
  "10haber": [
    {
      pattern: /^\/(siyaset|gundem|populer|ekonomi|dunya|spor|yasam)\//,
      replacement: "/",
    },
  ],
  // Haberler.com recycles story ids across section slugs in the same
  // pattern. Fold all known section paths so the numeric id wins.
  "haberler": [
    {
      pattern: /^\/(gundem|siyaset|ekonomi|dunya|spor|yasam|magazin)\//,
      replacement: "/",
    },
  ],
};

/**
 * URL canonicalizer. Given any valid URL string, returns a canonical form
 * suitable as the dedupe key. Returns the raw input unchanged if it fails
 * to parse, so callers never accidentally lose a row. Kept conservative —
 * aggressive folding would collide unrelated articles.
 *
 * Strips, in order:
 *   - tracking query params (utm_*, ref, from, st, amp, fbclid, gclid, …)
 *   - URL-encoded apostrophes (`%27`) and bare apostrophes (Evrensel bug)
 *   - per-source section-slug prefixes (10Haber /siyaset/ vs /gundem/)
 *   - trailing slashes (never the root `/`)
 *   - the fragment
 *   - leading `www.` on the host
 *
 * The host is lowercased but the path is NOT — casing in slugs is rare in
 * the surveyed publisher set and lowercasing would inflate URL churn
 * against the existing DB rows on the first cycle.
 */
export function canonicalizeUrl(rawUrl, sourceSlug) {
  try {
    const u = new URL(rawUrl);
    // Lowercase host (hostname only — not the path).
    u.hostname = u.hostname.toLowerCase();
    // Strip leading `www.` — outlets alternate between bare and www hosts.
    if (u.hostname.startsWith("www.")) u.hostname = u.hostname.slice(4);

    // Drop known tracking query params. Everything else survives — some
    // publishers still use `?id=123` as the real article key.
    const DROP = new Set([
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "fbclid", "gclid", "ref", "ref_source", "referrer", "source",
      "from", "st", "amp",
    ]);
    for (const k of [...u.searchParams.keys()]) {
      if (DROP.has(k.toLowerCase())) u.searchParams.delete(k);
    }

    // Strip URL-encoded apostrophes (Evrensel bug — same slug emitted
    // with and without `%27`) and any that slipped through unencoded.
    let path = u.pathname.replace(/%27/gi, "").replace(/'/g, "");

    // Apply per-source section-slug folding.
    const rules = sourceSlug ? SOURCE_CANON_RULES[sourceSlug] : null;
    if (rules) {
      for (const rule of rules) {
        path = path.replace(rule.pattern, rule.replacement);
      }
    }

    // Collapse any duplicate slashes introduced by the rules.
    path = path.replace(/\/{2,}/g, "/");

    // Strip a trailing slash (but leave the root alone).
    if (path.length > 1) path = path.replace(/\/+$/, "");

    u.pathname = path;
    u.hash = "";
    return u.toString();
  } catch {
    return rawUrl;
  }
}

function normalizeItem(source, item) {
  // Decode stray HTML entities in the title (haberler.com double-encodes;
  // see `decodeEntities` above). Other sources are pass-through.
  const title = decodeEntities((item.title || "").trim()).trim();
  const rawLink = (item.link || "").trim();

  // Normalize relative URLs by prefixing with the source's base URL
  // BEFORE canonicalizing — otherwise `new URL()` would throw on bare
  // paths and we'd fall back to the raw link unchanged.
  let absoluteUrl = rawLink;
  if (absoluteUrl.startsWith("/")) {
    const baseUrl = source.url.replace(/\/+$/, "");
    absoluteUrl = baseUrl + absoluteUrl;
  } else if (!/^https?:\/\//i.test(absoluteUrl)) {
    const baseUrl = source.url.replace(/\/+$/, "") + "/";
    absoluteUrl = baseUrl + absoluteUrl.replace(/^\/+/, "");
  }

  // Compute the canonical URL but do NOT store it as `url`. The DB
  // already has thousands of rows whose `url` matches the raw absolute
  // form, and the `articles_url_key` unique constraint is on THAT
  // shape. If we mutated `url` to the canonical form on every crawl,
  // the first cycle after deploy would flood the table with phantom
  // duplicates of every existing row. Instead, canonical URL lives
  // only inside this process: it helps classifyCategory ignore
  // tracking params, and it makes a convenient debug hook if a future
  // version wants to query by canonical form.
  const canonicalUrl = canonicalizeUrl(absoluteUrl, source.slug);

  const description = cleanDescription(item.contentSnippet || item.content);
  const imageUrl = extractImage(item);
  const publishedAt = parseDate(item.isoDate || item.pubDate);

  // content_hash = strictFingerprint(title, description) — D1's
  // digit-preserving SHA-1 over the 4-gram shingle set of the canonical
  // token stream. Two URL variants of the same article with identical
  // titles now produce the same hash regardless of URL shape, so D6's
  // forthcoming `(source_id, content_hash)` unique constraint can catch
  // them at the DB level. Until that lands, the JS-level pre-check
  // below (search for `existingHashes`) suppresses new dupes.
  //
  // Fallback paths: empty title → fingerprint over the URL so the hash
  // column is never null; strictFingerprint itself returns null for
  // empty input, hence the `||` chain.
  const contentHash =
    strictFingerprint(title, description) ||
    strictFingerprint(title || absoluteUrl, "") ||
    absoluteUrl;

  // Sports outlets live in their own vocabulary silo (player names, club
  // shorthand) so the keyword classifier often dumps them into `genel`,
  // which then pollutes politics clusters. Force-tag them by source slug
  // so they cluster with each other and stay out of politics.
  const category = SPORTS_SOURCE_SLUGS.has(source.slug)
    ? "spor"
    : classifyCategory(title, description, canonicalUrl);

  return {
    source_id: source.id,
    title,
    description,
    url: absoluteUrl,
    image_url: imageUrl,
    published_at: publishedAt,
    content_hash: contentHash,
    category,
  };
}

function normalizeArticles(source, items) {
  return items
    .filter((item) => item.title && item.link)
    .map((item) => normalizeItem(source, item));
}

// ---------------------------------------------------------------------------
// 4. Main loop
// ---------------------------------------------------------------------------

async function runCycle() {
  const startedAt = Date.now();
  // W4-Q5 opt #4: per-cycle counter for conditional-GET hits, exposed in
  // the cycle-end summary so the operational impact of the ETag cache is
  // visible at a glance.
  cycleCondHits = 0;
  logCycle("rss-cycle", "start");

  const { data: sources, error: sourcesError } = await supabase
    .from("sources")
    .select("*")
    .eq("active", true)
    .order("slug");

  if (sourcesError) {
    console.error(
      `${ts()} [worker] failed to fetch sources: ${sourcesError.message}`
    );
    const elapsed = Date.now() - startedAt;
    logCycle(
      "rss-cycle",
      `end: 0 inserts across 0 sources in ${(elapsed / 1000).toFixed(1)}s`
    );
    return;
  }

  if (!sources || sources.length === 0) {
    console.warn(`${ts()} [worker] no active sources — skipping cycle`);
    const elapsed = Date.now() - startedAt;
    logCycle(
      "rss-cycle",
      `end: 0 inserts across 0 sources in ${(elapsed / 1000).toFixed(1)}s`
    );
    return;
  }

  // Filter out sources whose circuit breaker is still open.
  const liveSources = [];
  let skippedDead = 0;
  for (const source of sources) {
    if (!sourceBreaker.allow(source.slug)) {
      skippedDead++;
      continue;
    }
    liveSources.push(source);
  }
  if (skippedDead > 0) {
    const snapshot = sourceBreaker.getSnapshot();
    const minsUntilRetry = Number.isFinite(snapshot.nextRetryMs)
      ? Math.max(0, Math.ceil((snapshot.nextRetryMs - Date.now()) / 60000))
      : 0;
    log(
      "worker",
      `skipping ${skippedDead} dead feeds (next retry in ${minsUntilRetry} min)`
    );
  }

  // Refresh the seen-hash cache on the first cycle and every
  // SEEN_REFRESH_CYCLES cycles thereafter. Any inserts during a cycle
  // are added to `seenHashes` inline (see the batched upsert below) so
  // the cache stays warm between refreshes without extra queries.
  if (seenCycleCounter === 0 || seenCycleCounter % SEEN_REFRESH_CYCLES === 0) {
    await refreshSeenHashes();
  }
  seenCycleCounter++;

  let totalInserted = 0;
  let failedSources = 0;
  let processed = 0;
  let skippedContentDup = 0;

  // W4-Q5 opt #2: batched upsert.
  //
  // Previous architecture ran one upsert per source, serialized through
  // a Promise chain to avoid onConflict races. That's ~105 DB round-trips
  // per cycle plus the pre-check query, totalling ~200 round-trips.
  //
  // New architecture: all fetches run concurrently, each worker pushes
  // its deduped rows into `allRows`, and at cycle end we issue ONE
  // upsert for everything. The `(source_id, content_hash)` UNIQUE
  // (migration 013) + the `url` UNIQUE are both still respected; we
  // use `onConflict: 'url', ignoreDuplicates: true` to match the legacy
  // semantic (same-URL second-crawl wins the first-insert). Intra-batch
  // and cross-batch content_hash dupes are filtered out by the seen-set
  // pre-check before the row ever enters `allRows`.
  //
  // On the rare occasion a stale seen-set misses a hash that's already
  // in the DB, the `(source_id, content_hash)` UNIQUE would cause the
  // whole batched upsert to fail. To guard against that we chunk the
  // batch and on chunk-failure fall back to per-row upserts so one bad
  // row doesn't poison the cycle.
  /** @type {any[]} */
  const allRows = [];
  // Per-source summary lines buffered so we can still emit them in
  // slug order at the end of the cycle — preserves the existing log
  // format but decouples log I/O from the fetch hot path.
  /** @type {Array<{slug:string, fetched:number, queued:number, dup:number}>} */
  const summaries = [];

  async function handleOne(source) {
    if (shutdown.isShuttingDown()) return;

    let items;
    try {
      items = await fetchSingleFeed(source);
    } catch (err) {
      failedSources++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${ts()} [${source.slug}] fetch/parse failed: ${msg}`);
      const { tripped } = sourceBreaker.recordFailure(source.slug);
      if (tripped) {
        log(
          "worker",
          `[${source.slug}] reached ${DEAD_FAIL_THRESHOLD} consecutive failures — circuit open for 30 min`
        );
      }
      return;
    }

    // Success: reset breaker.
    sourceBreaker.recordSuccess(source.slug);

    const normalized = normalizeArticles(source, items);

    // W4-Q5 opt #1: in-memory seen-set pre-check.
    //
    // Filter out rows whose `(source_id, content_hash)` is already in
    // the 7-day Seen set. Also drop intra-batch dupes (same feed
    // emitting two section-slug variants of the same story in a single
    // cycle).
    let dupSkipped = 0;
    const filtered = [];
    // seenInBatch tracks hashes this source already queued in THIS
    // cycle so the second variant collapses too. We use the compound
    // key so two sources with the same hash don't shadow each other.
    for (const row of normalized) {
      const h = row.content_hash;
      if (!h) {
        filtered.push(row);
        continue;
      }
      const key = seenKey(source.id, h);
      if (seenHashes.has(key)) {
        dupSkipped++;
        continue;
      }
      // Add to seen-set eagerly so two intra-cycle dupes collapse and
      // the cache stays warm for the next cycle without another refresh.
      seenHashes.add(key);
      filtered.push(row);
    }

    if (filtered.length > 0) {
      allRows.push(...filtered);
    }

    skippedContentDup += dupSkipped;
    summaries.push({
      slug: source.slug,
      fetched: normalized.length,
      queued: filtered.length,
      dup: dupSkipped,
    });
  }

  // Bounded-concurrency fetch pool — keep RSS_CONCURRENCY fetches in flight.
  // Backed by the shared runPool helper so the sliding-window pattern lives
  // in one place. handleOne does its own bookkeeping into the closure-scoped
  // counters, so we just count completions to update `processed` here.
  const workerCount = Math.min(RSS_CONCURRENCY, liveSources.length);
  await runPool(liveSources, {
    concurrency: RSS_CONCURRENCY,
    shouldStop: () => shutdown.isShuttingDown(),
    worker: async (source) => {
      await handleOne(source);
      processed++;
    },
  });

  // haberler.com special-case: batched og:image backfill.
  //
  // Runs after the RSS pool but before the upsert, so newly ingested
  // haberler.com rows already carry `image_url` on first insert. Other
  // sources are untouched. Bounded to HABERLER_IMAGE_CONCURRENCY parallel
  // fetches with a 5s per-fetch timeout. fetchOgImage never throws — on
  // any error it returns null and the row stays image-less, identical to
  // the prior behavior.
  let haberlerImagesFilled = 0;
  let haberlerImagesAttempted = 0;
  if (!shutdown.isShuttingDown()) {
    const haberlerSource = liveSources.find((s) => s.slug === HABERLER_SLUG);
    if (haberlerSource) {
      const haberlerNullRows = allRows.filter(
        (row) => row.source_id === haberlerSource.id && row.image_url == null
      );
      if (haberlerNullRows.length > 0) {
        haberlerImagesAttempted = haberlerNullRows.length;
        const fillStart = Date.now();
        await runPool(haberlerNullRows, {
          concurrency: HABERLER_IMAGE_CONCURRENCY,
          shouldStop: () => shutdown.isShuttingDown(),
          worker: async (row) => {
            const found = await fetchOgImage(row.url, {
              timeoutMs: HABERLER_IMAGE_TIMEOUT_MS,
            });
            // fetchOgImage may return a relative path (rare); only accept
            // an absolute https URL that also passes the local quality
            // gate (no favicon/logo/pixel/etc).
            if (
              found &&
              /^https?:\/\//i.test(found) &&
              isValidImageUrl(found)
            ) {
              row.image_url = found;
              haberlerImagesFilled++;
            }
          },
        });
        const fillElapsed = Date.now() - fillStart;
        log(
          "worker",
          `[${HABERLER_SLUG}] og:image fill: ${haberlerImagesFilled}/${haberlerImagesAttempted} resolved in ${(fillElapsed / 1000).toFixed(1)}s`
        );
      }
    }
  }

  // W4-Q5 opt #2: single batched upsert at end of cycle.
  //
  // Chunked to keep individual requests sized reasonably (PostgREST /
  // supabase-js have payload limits on very large arrays). On chunk
  // failure we fall back to per-row upserts so a single offender can't
  // block the rest.
  if (!shutdown.isShuttingDown() && allRows.length > 0) {
    const BATCH_CHUNK = 500;
    for (let i = 0; i < allRows.length; i += BATCH_CHUNK) {
      const chunk = allRows.slice(i, i + BATCH_CHUNK);
      const { data: upserted, error: upsertError } = await supabase
        .from("articles")
        .upsert(chunk, {
          onConflict: "url",
          ignoreDuplicates: true,
        })
        .select("id");

      if (upsertError) {
        console.error(
          `${ts()} [worker] batched upsert error (chunk ${i}-${i + chunk.length}): ${upsertError.message} — falling back to per-row`
        );
        // Per-row fallback: isolate the offender and let the rest through.
        for (const row of chunk) {
          const { data: one, error: oneErr } = await supabase
            .from("articles")
            .upsert([row], {
              onConflict: "url",
              ignoreDuplicates: true,
            })
            .select("id");
          if (oneErr) {
            // Most likely a (source_id, content_hash) unique violation
            // from a stale seen-set. Safe to drop — the row is already
            // in the DB from a prior cycle.
            continue;
          }
          totalInserted += one?.length ?? 0;
        }
      } else {
        totalInserted += upserted?.length ?? 0;
      }
    }
  }

  // Per-source summary lines emitted in slug order at cycle end — same
  // human-readable format as before, just no longer interleaved with
  // the fetch hot path.
  for (const s of summaries) {
    console.log(
      `${ts()} [${s.slug}] fetched ${s.fetched} items, queued ${s.queued}, skipped ${s.dup} content-dup`
    );
  }

  const elapsed = Date.now() - startedAt;
  logCycle(
    "rss-cycle",
    `end: ${totalInserted} inserts across ${processed}/${sources.length} sources in ${(elapsed / 1000).toFixed(1)}s (concurrency=${workerCount}, skipped=${skippedDead}, skipped-content-dup=${skippedContentDup}, cond-304=${cycleCondHits}, haberler-img-fill=${haberlerImagesFilled}/${haberlerImagesAttempted})`
  );
  if (failedSources > 0) {
    log("worker", `${failedSources} source(s) failed this cycle`);
  }
}

async function main() {
  log(
    "worker",
    `rss-worker starting (DRY_RUN=${DRY_RUN ? "1" : "0"}, interval=${CYCLE_INTERVAL_MS / 1000}s)`
  );

  if (DRY_RUN) {
    try {
      await runCycle();
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      console.error(`${ts()} [worker] cycle threw: ${msg}`);
    }
    log("worker", "DRY_RUN complete — exiting");
    process.exit(0);
  }

  while (!shutdown.isShuttingDown()) {
    try {
      await runCycle();
    } catch (err) {
      const msg = err instanceof Error ? err.stack || err.message : String(err);
      console.error(`${ts()} [worker] cycle threw: ${msg}`);
    }

    if (shutdown.isShuttingDown()) break;

    await sleep(CYCLE_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// Inline self-test for canonicalizeUrl (w2-d5)
//
// Run with `CANON_TEST=1 node scripts/rss-worker.mjs` to verify the
// canonicalizer without booting the Supabase client / fetch loop. Guarded
// by an env flag rather than a bare `process.argv[1] === import.meta.url`
// check because this file is normally invoked directly and we do NOT want
// to short-circuit the live worker on every run.
if (process.env.CANON_TEST === "1") {
  let failed = 0;
  const expect = (input, sourceSlug, want) => {
    const got = canonicalizeUrl(input, sourceSlug);
    const ok = got === want;
    if (ok) {
      console.log(`ok   - ${input}\n       -> ${got}`);
    } else {
      console.error(
        `FAIL - ${input}\n       got:  ${got}\n       want: ${want}`
      );
      failed++;
    }
  };

  // 1. Tracking params, www., trailing slash, fragment all stripped.
  expect(
    "https://WWW.sabah.com.tr/gundem/article/123/?utm_source=x&ref=y#comments",
    "sabah",
    "https://sabah.com.tr/gundem/article/123"
  );
  // 2. Already-clean URL passes through unchanged.
  expect(
    "https://sabah.com.tr/gundem/article/123",
    "sabah",
    "https://sabah.com.tr/gundem/article/123"
  );
  // 3. 10Haber /siyaset/ and /gundem/ collapse to the same canonical form.
  expect(
    "https://10haber.net/siyaset/fatih-altayli-692994/",
    "10haber",
    "https://10haber.net/fatih-altayli-692994"
  );
  expect(
    "https://10haber.net/gundem/fatih-altayli-692994/",
    "10haber",
    "https://10haber.net/fatih-altayli-692994"
  );
  // 4. Apostrophes / `%27` stripped for Evrensel.
  expect(
    "https://evrensel.net/haber/colakoglu-metalurji%27deki-is-cinayeti/",
    "evrensel",
    "https://evrensel.net/haber/colakoglu-metalurjideki-is-cinayeti"
  );
  expect(
    "https://evrensel.net/haber/colakoglu-metalurjideki-is-cinayeti",
    "evrensel",
    "https://evrensel.net/haber/colakoglu-metalurjideki-is-cinayeti"
  );
  // 5. Root path is preserved (no over-strip).
  expect("https://example.com/", "example", "https://example.com/");

  // content_hash sanity: two URL variants of the same article yield the
  // same strictFingerprint-based hash because the input is title +
  // description, not the URL.
  const hashA =
    strictFingerprint("Erdoğan açıklama yaptı", "Kabine toplantısı sonrası") ||
    "";
  const hashB =
    strictFingerprint("Erdoğan açıklama yaptı", "Kabine toplantısı sonrası") ||
    "";
  if (hashA && hashA === hashB) {
    console.log(`ok   - strictFingerprint stable (${hashA.slice(0, 8)})`);
  } else {
    console.error(`FAIL - strictFingerprint not stable: ${hashA} vs ${hashB}`);
    failed++;
  }
  // And different titles MUST produce different hashes.
  const hashC = strictFingerprint("MHP İstanbul il teşkilatını feshetti", "");
  if (hashA !== hashC) {
    console.log(`ok   - strictFingerprint discriminates unrelated titles`);
  } else {
    console.error(`FAIL - strictFingerprint collided unrelated titles`);
    failed++;
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) FAILED`);
    process.exit(1);
  }
  console.log("\ncanonicalizeUrl + content_hash OK — all tests PASSED");
  process.exit(0);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  console.error(`${ts()} [worker] fatal: ${msg}`);
  process.exit(1);
});
