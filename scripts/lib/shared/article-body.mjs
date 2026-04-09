// scripts/lib/shared/article-body.mjs
//
// Article body excerpt extractor for background workers. Many of our RSS
// sources ship feeds with empty <description> tags (title-only), which
// starves the cluster worker's token overlap + embedding paths. This helper
// fetches the article HTML and returns the first ~500 chars of the main
// content so the worker has something to cluster on.
//
// Extraction order (first hit wins):
//   1. <article> ... </article>                        — semantic HTML5
//   2. <main> ... </main>                              — page-level landmark
//   3. [itemprop="articleBody"] ... (closing tag)      — schema.org microdata
//   4. <meta property="og:description" content="…">   — OG metadata fallback
//   5. concatenated <p> ... </p> (first few)           — last-ditch scrape
//
// Contract (mirrors og-image.mjs):
//   - Never throws. Network/timeout/parse errors → returns null.
//   - 5s AbortController timeout by default. No new dependencies.
//   - Returns a trimmed plain-text string (HTML stripped, whitespace
//     collapsed), capped at 500 chars. Null when nothing usable was found.
//
// Usage:
//   import { fetchArticleBody } from "./lib/shared/article-body.mjs";
//   const excerpt = await fetchArticleBody("https://example.com/article");
//   if (excerpt) cluster.body = excerpt;

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 200_000;
const MAX_EXCERPT_CHARS = 500;

// Strip HTML tags, decode a handful of common entities, and collapse
// whitespace. The goal is "clustering-grade plain text" — not a faithful
// HTML-to-text renderer. Scripts/styles are removed first so their contents
// don't leak into the output.
function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCodePoint(Number(code));
      } catch {
        return " ";
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}

// Return the substring of `html` bounded by the first matching opening tag
// and its paired closing tag. Not a real parser — we do a cheap nesting
// counter so nested <article> blocks don't terminate early. Returns null
// when no match is found.
function extractByTag(html, tag) {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, "i");
  const openMatch = html.match(openRe);
  if (!openMatch) return null;
  const start = openMatch.index + openMatch[0].length;

  // Walk from `start` counting <tag> opens and </tag> closes. When depth
  // returns to zero we're at the matching close.
  const openG = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const closeG = new RegExp(`</${tag}\\s*>`, "gi");
  openG.lastIndex = start;
  closeG.lastIndex = start;

  let depth = 1;
  let cursor = start;
  while (depth > 0) {
    openG.lastIndex = cursor;
    closeG.lastIndex = cursor;
    const nextOpen = openG.exec(html);
    const nextClose = closeG.exec(html);
    if (!nextClose) return null; // unterminated — give up
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(start, nextClose.index);
      cursor = nextClose.index + nextClose[0].length;
    }
  }
  return null;
}

// itemprop="articleBody" lives on an arbitrary element — could be div, span,
// section, article. We find the opening tag, capture its tag name, then
// delegate to extractByTag for the close-match walk.
function extractByItemprop(html) {
  const m = html.match(/<(\w+)\b[^>]*itemprop=["']articleBody["'][^>]*>/i);
  if (!m) return null;
  const tag = m[1];
  // Re-run extractByTag scoped to the substring starting at this opener so
  // we match the right closing tag even if earlier same-named tags exist.
  const sub = html.slice(m.index);
  return extractByTag(sub, tag);
}

function extractOgDescription(html) {
  const a = html.match(
    /<meta\s+(?:[^>]*?\s+)?property=["']og:description["']\s+content=["']([^"']+)["']/i
  );
  if (a) return a[1];
  const b = html.match(
    /content=["']([^"']+)["']\s+(?:[^>]*?\s+)?property=["']og:description["']/i
  );
  if (b) return b[1];
  return null;
}

// Collect the text of the first several <p> tags. We cap at 8 paragraphs
// which, combined with the 500-char excerpt ceiling, gives us a predictable
// upper bound on work even when the page is paragraph-heavy.
function extractParagraphs(html) {
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  const chunks = [];
  let match;
  let count = 0;
  while ((match = re.exec(html)) !== null && count < 8) {
    const text = htmlToText(match[1]);
    if (text.length >= 20) {
      chunks.push(text);
      count += 1;
    }
    if (chunks.join(" ").length >= MAX_EXCERPT_CHARS * 2) break;
  }
  return chunks.length > 0 ? chunks.join(" ") : null;
}

/**
 * Run the ordered extractor list against an HTML blob and return the first
 * hit as a trimmed, capped plain-text excerpt. Exported for unit tests —
 * real callers should use `fetchArticleBody`.
 *
 * @param {string} html
 * @returns {string | null}
 */
export function extractArticleBodyFromHtml(html) {
  if (!html) return null;

  const extractors = [
    () => {
      const raw = extractByTag(html, "article");
      return raw ? htmlToText(raw) : null;
    },
    () => {
      const raw = extractByTag(html, "main");
      return raw ? htmlToText(raw) : null;
    },
    () => {
      const raw = extractByItemprop(html);
      return raw ? htmlToText(raw) : null;
    },
    () => {
      const raw = extractOgDescription(html);
      return raw ? htmlToText(raw) : null;
    },
    () => extractParagraphs(html),
  ];

  for (const extract of extractors) {
    const candidate = extract();
    if (candidate && candidate.length >= 40) {
      return candidate.slice(0, MAX_EXCERPT_CHARS).trim();
    }
  }
  return null;
}

/**
 * Fetch `url`, read up to 200KB of the response body, and return a plain-text
 * excerpt of the article's main content (≤ 500 chars). Returns null on any
 * network/timeout/parse error — callers treat null as "no body found" and
 * continue without enrichment.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string | null>}
 */
export async function fetchArticleBody(url, opts = {}) {
  if (!url || typeof url !== "string") return null;

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
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // ignore — socket may already be aborted
      }
    }

    return extractArticleBodyFromHtml(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Self-test: `SELF_TEST=1 node scripts/lib/shared/article-body.mjs <url>`
// Fetches the given URL (or a built-in sample if none provided) and prints
// the extracted excerpt. Gated by env so importing the module stays
// side-effect free.
// ---------------------------------------------------------------------------
if (process.env.SELF_TEST === "1") {
  const url = process.argv[2] || "https://www.aa.com.tr/tr/gundem";
  (async () => {
    const t0 = Date.now();
    const excerpt = await fetchArticleBody(url, { timeoutMs: 5000 });
    const ms = Date.now() - t0;
    if (excerpt) {
      console.log(`[${ms}ms] ${url}`);
      console.log(`  length: ${excerpt.length}`);
      console.log(`  excerpt: ${excerpt}`);
    } else {
      console.log(`[${ms}ms] ${url} -> NONE`);
    }
  })().catch((err) => {
    console.error("self-test fatal:", err);
    process.exit(1);
  });
}
