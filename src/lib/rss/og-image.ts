/**
 * Fallback image extraction: fetch article page and extract og:image meta tag.
 * Used for sources that don't include images in their RSS feeds (e.g. Diken, Medyascope).
 */

const OG_IMAGE_REGEX = /<meta\s+(?:[^>]*?\s+)?property=["']og:image["']\s+content=["']([^"']+)["']/i;
const OG_IMAGE_REGEX_ALT = /content=["']([^"']+)["']\s+(?:[^>]*?\s+)?property=["']og:image["']/i;

export async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Tayf/1.0; +https://tayf.app)",
        Accept: "text/html",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    // Only read the first 50KB — og:image is always in <head>
    const reader = response.body?.getReader();
    if (!reader) return null;

    let html = "";
    const decoder = new TextDecoder();

    while (html.length < 50000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });

      // Check if we've passed </head> — no need to read further
      if (html.includes("</head>")) break;
    }

    reader.cancel();

    const match = html.match(OG_IMAGE_REGEX) || html.match(OG_IMAGE_REGEX_ALT);
    return match?.[1] || null;
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
    const fetched = await Promise.allSettled(
      batch.map(async (article) => {
        const ogImage = await fetchOgImage(article.url);
        if (ogImage) results.set(article.url, ogImage);
      })
    );
  }

  return results;
}
