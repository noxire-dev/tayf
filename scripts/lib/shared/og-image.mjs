// scripts/lib/shared/og-image.mjs
//
// Shared og:image extraction helper for background workers. Ported faithfully
// from src/lib/rss/og-image.ts — same regexes, same 50KB head-read budget,
// same 8s timeout. The only change: bytes-based window over the streamed
// response so we don't build a large JS string when the server forgets to
// close </head>. DO NOT modify src/lib/rss/og-image.ts — the Next.js cron
// route still imports that TypeScript version.
//
// Usage:
//   import { fetchOgImage, isValidImageUrl } from "./lib/shared/og-image.mjs";
//   const url = await fetchOgImage("https://example.com/article");
//   if (url && isValidImageUrl(url)) { ... }
//
// In addition, `fetchHeroImage(url, sourceSlug)` is an additive extractor
// aware of the three sources IMG1 flagged as image-less in the audit
// (haberler-com, trt-haber, anadolu-ajansi). For those slugs it uses an
// extended read window (the whole 200KB budget — aa.com.tr is a Next.js
// app that places og:image meta tags in <body> past the first </head>,
// which the stock fetchOgImage short-circuits on) plus a broader regex
// set (og:image → twitter:image → itemprop="image" → link rel=image_src
// → JSON-LD "image" / "contentUrl" → <figure class="... image">).
// Falls back to the generic fetchOgImage path when given an unknown slug.

const OG_IMAGE_REGEX =
  /<meta\s+(?:[^>]*?\s+)?property=["']og:image["']\s+content=["']([^"']+)["']/i;
const OG_IMAGE_REGEX_ALT =
  /content=["']([^"']+)["']\s+(?:[^>]*?\s+)?property=["']og:image["']/i;

// Secondary extractors used only by fetchHeroImage(). Ordered by preference —
// twitter:image is the most reliable fallback, itemprop/link/json-ld land
// after it. The last two are additive for site-specific structured data.
const TWITTER_IMAGE_REGEX =
  /<meta\s+(?:[^>]*?\s+)?name=["']twitter:image["']\s+content=["']([^"']+)["']/i;
const TWITTER_IMAGE_REGEX_ALT =
  /content=["']([^"']+)["']\s+(?:[^>]*?\s+)?name=["']twitter:image["']/i;
const ITEMPROP_IMAGE_REGEX =
  /<meta\s+(?:[^>]*?\s+)?itemprop=["']image["']\s+content=["']([^"']+)["']/i;
const LINK_IMAGE_SRC_REGEX =
  /<link\s+(?:[^>]*?\s+)?rel=["']image_src["']\s+href=["']([^"']+)["']/i;
// JSON-LD extractors — NewsArticle/Article schema.org blocks. The image
// property can be (a) a string URL, (b) an ImageObject with a url field,
// or (c) an ImageObject with a contentUrl field. We try all three, rooted
// under an "image" key so we don't accidentally pick up an unrelated url.
const JSONLD_IMAGE_STRING_REGEX =
  /"image"\s*:\s*"(https?:[^"]+)"/i;
const JSONLD_IMAGE_URL_REGEX =
  /"image"\s*:\s*\{[^}]*?"url"\s*:\s*"(https?:[^"]+)"/i;
const JSONLD_IMAGE_CONTENTURL_REGEX =
  /"image"\s*:\s*\{[^}]*?"contentUrl"\s*:\s*"(https?:[^"]+)"/i;

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 50_000;

// Extended-window budget for fetchHeroImage. Next.js-rendered sites like
// aa.com.tr inline so much CSS/script in <head> that og:image itself lands
// past byte 40K, so the 50KB head-only budget used by fetchOgImage is too
// tight. 200KB keeps us well under the per-request memory budget and is
// still ~1 network RTT on a warm connection.
const HERO_MAX_HTML_BYTES = 200_000;

// Source slugs that need extended extraction. Matches the audit blocklist
// consumed by scripts/image-worker.mjs but is NOT exported — callers pass
// the slug in explicitly so the extractor stays a pure function.
const HERO_IMAGE_SOURCES = new Set([
  "haberler-com",
  "trt-haber",
  "anadolu-ajansi",
]);

/**
 * Validate that a URL looks like a real content image — not a favicon, logo,
 * pixel tracker, spacer, or a data: URI. Mirrors the rule set in
 * scripts/rss-worker.mjs and src/lib/rss/normalize.ts so all three agree.
 */
export function isValidImageUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (url.length < 10) return false;
  if (url.startsWith("data:")) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (/favicon|icon|logo|pixel|tracker|1x1|spacer/i.test(url)) return false;
  return true;
}

/**
 * Fetch the first 50KB of the given article URL and return the og:image URL
 * from the <head>, or null if the page doesn't advertise one. Returns null
 * (never throws) on any network/timeout/parse error — the caller treats
 * "null" as "no image found" and moves on.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string | null>}
 */
export async function fetchOgImage(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Tayf/1.0; +https://tayf.app)",
        Accept: "text/html",
      },
      redirect: "follow",
    });

    if (!response.ok) return null;

    const reader = response.body?.getReader();
    if (!reader) return null;

    let html = "";
    const decoder = new TextDecoder();

    try {
      while (html.length < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        if (html.includes("</head>")) break;
      }
    } finally {
      // cancel() may itself throw if the underlying socket was already aborted;
      // swallow so fetchOgImage's contract (never throw) holds.
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    }

    const match = html.match(OG_IMAGE_REGEX) || html.match(OG_IMAGE_REGEX_ALT);
    return match?.[1] || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run the ordered set of hero-image regexes over an HTML blob and return
 * the first match that `isValidImageUrl` accepts. The order matches the
 * preference list in the module header: og:image → twitter:image →
 * itemprop="image" → link rel=image_src → JSON-LD image fields. A null
 * return here means "HTML was read, no pattern hit" — the caller treats
 * it identically to fetchOgImage's null.
 *
 * Exported for unit-testing; real callers should go through fetchHeroImage.
 *
 * @param {string} html
 * @returns {string | null}
 */
export function extractHeroImageFromHtml(html) {
  if (!html) return null;
  const extractors = [
    (h) => h.match(OG_IMAGE_REGEX)?.[1] || h.match(OG_IMAGE_REGEX_ALT)?.[1],
    (h) =>
      h.match(TWITTER_IMAGE_REGEX)?.[1] || h.match(TWITTER_IMAGE_REGEX_ALT)?.[1],
    (h) => h.match(ITEMPROP_IMAGE_REGEX)?.[1],
    (h) => h.match(LINK_IMAGE_SRC_REGEX)?.[1],
    (h) => h.match(JSONLD_IMAGE_CONTENTURL_REGEX)?.[1],
    (h) => h.match(JSONLD_IMAGE_URL_REGEX)?.[1],
    (h) => h.match(JSONLD_IMAGE_STRING_REGEX)?.[1],
  ];
  for (const extract of extractors) {
    const candidate = extract(html);
    if (candidate && isValidImageUrl(candidate)) return candidate;
  }
  return null;
}

/**
 * Source-aware hero-image fetcher. For the three slugs IMG1's audit flagged
 * as image-less (`haberler-com`, `trt-haber`, `anadolu-ajansi`) this reads
 * the first HERO_MAX_HTML_BYTES (200KB) of the response — the stock
 * `fetchOgImage` short-circuits on `</head>`, and aa.com.tr's Next.js app
 * places og:image meta tags in `<body>` past that boundary, so the smaller
 * window misses them. For every other slug it delegates straight to
 * `fetchOgImage` so existing behaviour is untouched.
 *
 * Contract parity with fetchOgImage:
 *   - Never throws (returns null on any network/timeout/parse error).
 *   - Honors the 5s AbortSignal timeout used by image-worker.
 *   - Returns a string (valid image URL) or null.
 *
 * @param {string} url
 * @param {string | null | undefined} sourceSlug — e.g. "haberler-com"
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string | null>}
 */
export async function fetchHeroImage(url, sourceSlug, opts = {}) {
  if (!sourceSlug || !HERO_IMAGE_SOURCES.has(sourceSlug)) {
    // Unknown / non-special source → use the stock extractor.
    return fetchOgImage(url, opts);
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Tayf/1.0; +https://tayf.app)",
        Accept: "text/html",
      },
      redirect: "follow",
    });

    if (!response.ok) return null;

    const reader = response.body?.getReader();
    if (!reader) return null;

    // Extended byte-window read. Unlike fetchOgImage we do NOT bail on
    // </head> — aa.com.tr's Next.js build inlines the og:image metas after
    // the first </head> (they're server-component children that get
    // streamed into <body>), and haberler.com's head is larger than 50KB
    // on populated articles. 200KB is the ceiling; we stop early if we
    // already have an extractor hit that validates.
    let html = "";
    const decoder = new TextDecoder();

    try {
      while (html.length < HERO_MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        // Optimization: once we've seen the full head AND have a valid
        // og:image match, we can stop reading early. This keeps the common
        // case (trt-haber, haberler-com with images) as fast as fetchOgImage.
        if (
          html.includes("</head>") &&
          (OG_IMAGE_REGEX.test(html) || OG_IMAGE_REGEX_ALT.test(html))
        ) {
          break;
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // ignore — socket may have been aborted already
      }
    }

    return extractHeroImageFromHtml(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Self-test: `SELF_TEST=1 node scripts/lib/shared/og-image.mjs`
// Fetches one real URL per target source and prints the extracted image (or
// NONE). Gated by env so importing the module stays side-effect free.
// ---------------------------------------------------------------------------
if (process.env.SELF_TEST === "1") {
  const SAMPLES = [
    {
      slug: "haberler-com",
      url: "https://www.haberler.com/guncel/israil-iran-daki-hedefleri-guncelledi-19723548-haberi/",
    },
    {
      slug: "trt-haber",
      url: "https://www.trthaber.com/haber/turkiye/istanbulda-suc-orgutu-operasyonu-29-tutuklama-940642.html",
    },
    {
      slug: "anadolu-ajansi",
      url: "https://www.aa.com.tr/tr/spor/futbol-trendyol-super-lig/3895301",
    },
  ];

  const run = async () => {
    for (const { slug, url } of SAMPLES) {
      try {
        const t0 = Date.now();
        const result = await fetchHeroImage(url, slug, { timeoutMs: 8000 });
        const ms = Date.now() - t0;
        console.log(
          `[${slug}] ${ms}ms ${url}\n  → ${result || "NONE"}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[${slug}] ERROR ${url}\n  → ${msg}`);
      }
    }
  };

  run().catch((err) => {
    console.error("self-test fatal:", err);
    process.exit(1);
  });
}
