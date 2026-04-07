/**
 * Fallback image extraction: fetch article page and extract og:image meta tag.
 * Used for sources that don't include images in their RSS feeds (e.g. Hürriyet, Diken, Medyascope).
 *
 * Tries in order: og:image → twitter:image
 */

// property="og:image" content="…" (standard order)
const OG_IMAGE_REGEX =
  /<meta\s+(?:[^>]*?\s+)?property=["']og:image["']\s+(?:[^>]*?\s+)?content=["']([^"']+)["']/i;
// content="…" property="og:image" (reversed order, some sites do this)
const OG_IMAGE_REGEX_ALT =
  /<meta\s+(?:[^>]*?\s+)?content=["']([^"']+)["']\s+(?:[^>]*?\s+)?property=["']og:image["']/i;
// name="twitter:image" content="…"
const TWITTER_IMAGE_REGEX =
  /<meta\s+(?:[^>]*?\s+)?name=["']twitter:image["']\s+(?:[^>]*?\s+)?content=["']([^"']+)["']/i;
const TWITTER_IMAGE_REGEX_ALT =
  /<meta\s+(?:[^>]*?\s+)?content=["']([^"']+)["']\s+(?:[^>]*?\s+)?name=["']twitter:image["']/i;

// Use a realistic browser UA — some Turkish news sites serve different content to bots
const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": FETCH_UA,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    // Only read the first 100KB — og:image is always in <head>
    const reader = response.body?.getReader();
    if (!reader) return null;

    let html = "";
    const decoder = new TextDecoder();

    while (html.length < 100_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });

      // Once we've passed </head>, no need to keep reading
      if (html.includes("</head>")) break;
    }

    reader.cancel();

    // Try og:image first, then twitter:image
    const match =
      html.match(OG_IMAGE_REGEX) ||
      html.match(OG_IMAGE_REGEX_ALT) ||
      html.match(TWITTER_IMAGE_REGEX) ||
      html.match(TWITTER_IMAGE_REGEX_ALT);

    if (!match?.[1]) return null;

    // Decode HTML entities in the URL (some sites encode & as &amp;)
    const decoded = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');

    return decoded;
  } catch {
    return null;
  }
}

/**
 * Batch fetch og:image for articles that are missing images.
 * Processes in parallel with concurrency limit to avoid hammering servers.
 */
export async function batchFetchOgImages(
  articles: { url: string; image_url: string | null }[]
): Promise<Map<string, string>> {
  const missing = articles.filter((a) => !a.image_url);
  if (missing.length === 0) return new Map();

  const results = new Map<string, string>();
  const CONCURRENCY = 5;

  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (article) => {
        const ogImage = await fetchOgImage(article.url);
        if (ogImage) results.set(article.url, ogImage);
      })
    );
  }

  return results;
}
