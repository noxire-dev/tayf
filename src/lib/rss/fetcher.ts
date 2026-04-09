import Parser from "rss-parser";
import type { Source } from "@/types";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (compatible; Tayf/1.0; +https://tayf.app)",
  Accept: "application/rss+xml, application/xml, text/xml, application/atom+xml",
};

const parser = new Parser({
  timeout: 15000,
  headers: DEFAULT_HEADERS,
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: false }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: false }],
      ["media:group", "mediaGroup", { keepArray: false }],
      ["enclosure", "enclosure", { keepArray: false }],
      ["content:encoded", "contentEncoded"],
      // CNN Türk (and others) put images as <image>URL</image> inside <item>
      ["image", "itemImage"],
    ],
  },
});

export interface RawFeedItem {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  contentEncoded?: string;
  pubDate?: string;
  isoDate?: string;
  enclosure?: { url?: string; type?: string; $?: { url?: string; type?: string } };
  mediaContent?: { $?: { url?: string } };
  mediaThumbnail?: { $?: { url?: string } };
  mediaGroup?: {
    "media:content"?: { $?: { url?: string } };
    "media:thumbnail"?: { $?: { url?: string } };
  };
  itemImage?: string | { url?: string };
  [key: string]: unknown;
}

export interface FetchResult {
  source: Source;
  items: RawFeedItem[];
  error?: string;
}

// Per-source header overrides (merged on top of DEFAULT_HEADERS)
const SOURCE_HEADERS: Record<string, Record<string, string>> = {
  // Add source-specific overrides here if a site blocks the bot UA.
  // Example: "some-slug": { "User-Agent": "Mozilla/5.0 ..." },
};

export async function fetchAllFeeds(
  sources: Source[]
): Promise<FetchResult[]> {
  const results = await Promise.allSettled(
    sources.map((source) => fetchSingleFeed(source))
  );

  return results.map((result, i): FetchResult => {
    if (result.status === "fulfilled") return result.value;
    // `i` is always within bounds since `results.length === sources.length`,
    // but `noUncheckedIndexedAccess` doesn't know that. Fall back to a stub
    // source if the index ever drifts so we still return a typed FetchResult.
    const source = sources[i] ?? {
      id: "",
      name: "unknown",
      slug: "unknown",
      url: "",
      rss_url: "",
      bias: "center" as const,
      logo_url: null,
      active: false,
    };
    return {
      source,
      items: [],
      error:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
    };
  });
}

async function fetchSingleFeed(source: Source): Promise<FetchResult> {
  const extraHeaders = SOURCE_HEADERS[source.slug] || {};
  const headers = { ...DEFAULT_HEADERS, ...extraHeaders };

  // Fetch XML manually so we can use per-source headers,
  // then parse with rss-parser's parseString.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(source.rss_url, {
      signal: controller.signal,
      headers,
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        source,
        items: [],
        error: `HTTP ${response.status} from ${source.slug}`,
      };
    }

    const xml = await response.text();
    const feed = await parser.parseString(xml);

    return {
      source,
      items: (feed.items || []) as unknown as RawFeedItem[],
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      source,
      items: [],
      error: (err as Error).message,
    };
  }
}
