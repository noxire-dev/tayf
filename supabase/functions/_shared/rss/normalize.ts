// supabase/functions/_shared/rss/normalize.ts
//
// Port of `src/lib/rss/normalize.ts` + `scripts/rss-worker.mjs`'s
// `normalizeItem` into Deno-friendly TypeScript. Two material differences
// vs the legacy modules:
//
//   1. content_hash is computed via `strictFingerprint` ONLY (the canonical
//      sha1-of-shingles algorithm from `_shared/cluster/fingerprint.ts`).
//      The SHA-256(title+url) path is removed entirely — audit T7 P1-21
//      flagged the dual-regime as the root cause of duplicate clusters.
//      B9's migration 026 backfills any rows still carrying the legacy
//      64-char hash.
//
//   2. URL canonicalisation lives inside normalize so the ingest function
//      can pre-compute it once per item without depending on the legacy
//      worker module.
//
// Sports-source tagging, the keyword classifier, the entity decoder, and
// the image extractor are ported verbatim — they are dialect, not algorithm.

import { sha1, strictFingerprint } from "../cluster/fingerprint.ts";
import type { RawFeedItem, RssSource } from "./fetcher.ts";

export type NewsCategory =
  | "son_dakika"
  | "politika"
  | "dunya"
  | "ekonomi"
  | "spor"
  | "teknoloji"
  | "yasam"
  | "genel";

export interface NormalizedArticle {
  source_id: string;
  title: string;
  description: string | null;
  url: string;
  image_url: string | null;
  published_at: string;
  content_hash: string;
  category: NewsCategory;
}

// ---------------------------------------------------------------------------
// Category classifier
// ---------------------------------------------------------------------------

const SPORTS_SOURCE_SLUGS: ReadonlySet<string> = new Set([
  "fotomac",
  "fotospor",
  "a-spor",
  "ntv-spor",
  "kontraspor",
  "ajansspor",
]);

const CATEGORY_RULES: ReadonlyArray<{ category: NewsCategory; keywords: RegExp }> = [
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

function detectCategoryFromUrl(url: string): NewsCategory | null {
  const path = url.toLowerCase();
  if (/\/spor\/|\/sport/.test(path)) return "spor";
  if (/\/siyaset\/|\/politika\/|\/politi/.test(path)) return "politika";
  if (/\/ekonomi\/|\/finans\/|\/economy/.test(path)) return "ekonomi";
  if (/\/teknoloji\/|\/tech/.test(path)) return "teknoloji";
  if (/\/dunya\/|\/world\/|\/global/.test(path)) return "dunya";
  if (/\/yasam\/|\/life\/|\/saglik\/|\/egitim/.test(path)) return "yasam";
  return null;
}

function classifyCategory(
  title: string,
  description: string | null,
  url: string,
): NewsCategory {
  const text = `${title} ${description ?? ""} ${url}`.toLowerCase();
  const first = CATEGORY_RULES[0];
  if (first && first.keywords.test(text)) return first.category;
  const urlCategory = detectCategoryFromUrl(url);
  if (urlCategory) return urlCategory;
  for (let i = 1; i < CATEGORY_RULES.length; i++) {
    const rule = CATEGORY_RULES[i];
    if (rule && rule.keywords.test(text)) return rule.category;
  }
  return "genel";
}

// ---------------------------------------------------------------------------
// Image extraction
// ---------------------------------------------------------------------------

function isValidImageUrl(url: string): boolean {
  if (!url || url.length < 10) return false;
  if (url.startsWith("data:")) return false;
  if (/favicon|icon|logo|pixel|tracker|1x1|spacer/i.test(url)) return false;
  return true;
}

function getImageEnclosure(item: RawFeedItem): string | null {
  if (!item.enclosure?.url) return null;
  const type = item.enclosure.type ?? "";
  if (type && !type.startsWith("image/")) return null;
  return item.enclosure.url;
}

function extractImage(item: RawFeedItem): string | null {
  const fromFields =
    getImageEnclosure(item) ??
    item.mediaContent?.$?.url ??
    item.mediaThumbnail?.$?.url ??
    item.mediaGroup?.["media:content"]?.$?.url ??
    item.mediaGroup?.["media:thumbnail"]?.$?.url ??
    null;
  if (fromFields) return fromFields;

  if (item.itemImage && isValidImageUrl(item.itemImage)) return item.itemImage;

  const htmlContent = item.contentEncoded ?? item.content ?? "";
  if (htmlContent) {
    const m = htmlContent.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m?.[1] && isValidImageUrl(m[1])) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function decodeEntities(text: string): string {
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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    );
}

function cleanDescription(raw?: string | null): string | null {
  if (!raw) return null;
  const text = decodeEntities(raw.replace(/<[^>]*>/g, "")).trim();
  if (!text) return null;
  return text.length > 500 ? text.slice(0, 497) + "..." : text;
}

function parseDate(raw?: string): string {
  if (!raw) return new Date().toISOString();
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

// ---------------------------------------------------------------------------
// URL canonicalisation
// ---------------------------------------------------------------------------

const SOURCE_CANON_RULES: Record<string, Array<{ pattern: RegExp; replacement: string }>> = {
  "10haber": [
    {
      pattern: /^\/(siyaset|gundem|populer|ekonomi|dunya|spor|yasam)\//,
      replacement: "/",
    },
  ],
  haberler: [
    {
      pattern: /^\/(gundem|siyaset|ekonomi|dunya|spor|yasam|magazin)\//,
      replacement: "/",
    },
  ],
};

const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "ref",
  "ref_source",
  "referrer",
  "source",
  "from",
  "st",
  "amp",
]);

export function canonicalizeUrl(
  rawUrl: string,
  sourceSlug?: string,
): string {
  try {
    const u = new URL(rawUrl);
    u.hostname = u.hostname.toLowerCase();
    if (u.hostname.startsWith("www.")) u.hostname = u.hostname.slice(4);

    for (const k of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
    }

    let path = u.pathname.replace(/%27/gi, "").replace(/'/g, "");

    const rules = sourceSlug ? SOURCE_CANON_RULES[sourceSlug] : undefined;
    if (rules) {
      for (const rule of rules) {
        path = path.replace(rule.pattern, rule.replacement);
      }
    }
    path = path.replace(/\/{2,}/g, "/");
    if (path.length > 1) path = path.replace(/\/+$/, "");

    u.pathname = path;
    u.hash = "";
    return u.toString();
  } catch {
    return rawUrl;
  }
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function absolutiseUrl(rawLink: string, source: RssSource): string {
  if (/^https?:\/\//i.test(rawLink)) return rawLink;
  if (rawLink.startsWith("/")) {
    const baseUrl = source.url.replace(/\/+$/, "");
    return baseUrl + rawLink;
  }
  const baseUrl = source.url.replace(/\/+$/, "") + "/";
  return baseUrl + rawLink.replace(/^\/+/, "");
}

/**
 * Normalise a single raw RSS item into the row shape expected by the
 * `articles` table. `content_hash` is computed via `strictFingerprint`
 * exclusively. Returns `null` if the item lacks a title or a link.
 */
export function normalizeItem(
  source: RssSource,
  item: RawFeedItem,
): NormalizedArticle | null {
  const rawTitle = item.title?.trim() ?? "";
  const rawLink = item.link?.trim() ?? "";
  if (!rawTitle || !rawLink) return null;

  const title = decodeEntities(rawTitle).trim();
  const absoluteUrl = absolutiseUrl(rawLink, source);
  const canonicalUrl = canonicalizeUrl(absoluteUrl, source.slug);

  const description = cleanDescription(item.contentSnippet ?? item.content);
  const imageUrl = extractImage(item);
  const publishedAt = parseDate(item.isoDate ?? item.pubDate);

  // Strict sha1-of-shingles content hash. Fallbacks mirror the worker's
  // chain so `content_hash` is never null — the column is NOT NULL. The
  // final fallback hashes the canonical absolute URL bytes with SHA-1 so
  // the output is always a 40-char lowercase hex digest, matching the
  // `articles.content_hash` CHECK constraint introduced in migration 026.
  const contentHash =
    strictFingerprint(title, description) ??
    strictFingerprint(title || absoluteUrl, "") ??
    sha1(absoluteUrl);

  const category: NewsCategory = SPORTS_SOURCE_SLUGS.has(source.slug)
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

/**
 * Normalise an array of raw items, dropping any that fail the title/link
 * filter. Order preserved.
 */
export function normalizeArticles(
  source: RssSource,
  items: RawFeedItem[],
): NormalizedArticle[] {
  const out: NormalizedArticle[] = [];
  for (const item of items) {
    const row = normalizeItem(source, item);
    if (row) out.push(row);
  }
  return out;
}
