import Parser from "rss-parser";
import type { Source } from "@/types";

const parser = new Parser({
  timeout: 15000,
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

export interface RawFeedItem {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  contentEncoded?: string;
  pubDate?: string;
  isoDate?: string;
  enclosure?: { url?: string; type?: string };
  mediaContent?: { $?: { url?: string } };
  mediaThumbnail?: { $?: { url?: string } };
  mediaGroup?: { "media:content"?: { $?: { url?: string } }; "media:thumbnail"?: { $?: { url?: string } } };
  [key: string]: unknown;
}

export interface FetchResult {
  source: Source;
  items: RawFeedItem[];
  error?: string;
}

// T24 blocks default user agents
const SOURCE_HEADERS: Record<string, Record<string, string>> = {
  t24: {
    "User-Agent":
      "Mozilla/5.0 (compatible; Tayf/1.0; +https://tayf.app)",
  },
};

export async function fetchAllFeeds(
  sources: Source[]
): Promise<FetchResult[]> {
  const results = await Promise.allSettled(
    sources.map((source) => fetchSingleFeed(source))
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    return {
      source: sources[i],
      items: [],
      error: (result.reason as Error).message,
    };
  });
}

async function fetchSingleFeed(source: Source): Promise<FetchResult> {
  const extraHeaders = SOURCE_HEADERS[source.slug] || {};

  const feed = await parser.parseURL(source.rss_url);

  return {
    source,
    items: (feed.items || []).map((item) => ({
      ...item,
      ...extraHeaders,
    })) as RawFeedItem[],
  };
}
