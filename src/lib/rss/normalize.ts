import SHA256 from "crypto-js/sha256";
import type { Source, NewsCategory } from "@/types";
import type { RawFeedItem } from "./fetcher";

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

export function normalizeArticles(
  source: Source,
  items: RawFeedItem[]
): NormalizedArticle[] {
  return items
    .filter((item) => item.title && item.link)
    .map((item) => normalizeItem(source, item));
}

function normalizeItem(
  source: Source,
  item: RawFeedItem
): NormalizedArticle {
  // Decode any stray HTML entities in the title (haberler.com double-encodes;
  // see `decodeEntities` above).
  const title = decodeEntities((item.title || "").trim()).trim();
  const url = (item.link || "").trim();

  // Normalize relative URLs by prefixing with the source's base URL
  let normalizedUrl = url;
  if (normalizedUrl.startsWith("/")) {
    // Strip any trailing slash from source.url and prepend
    const baseUrl = source.url.replace(/\/+$/, "");
    normalizedUrl = baseUrl + normalizedUrl;
  } else if (!/^https?:\/\//i.test(normalizedUrl)) {
    // Any other relative form (no scheme) → also prefix
    const baseUrl = source.url.replace(/\/+$/, "") + "/";
    normalizedUrl = baseUrl + normalizedUrl.replace(/^\/+/, "");
  }

  const description = cleanDescription(item.contentSnippet || item.content);
  const imageUrl = extractImage(item);
  const publishedAt = parseDate(item.isoDate || item.pubDate);
  const contentHash = SHA256(title + normalizedUrl).toString();
  // Sports outlets live in their own vocabulary silo (player names, club
  // shorthand) so the keyword classifier often dumps them into `genel`,
  // which then pollutes politics clusters. Force-tag them by source slug
  // so they cluster with each other and stay out of politics.
  const category: NewsCategory = SPORTS_SOURCE_SLUGS.has(source.slug)
    ? "spor"
    : classifyCategory(title, description, normalizedUrl);

  return {
    source_id: source.id,
    title,
    description,
    url: normalizedUrl,
    image_url: imageUrl,
    published_at: publishedAt,
    content_hash: contentHash,
    category,
  };
}

// Sources whose entire output is sports — bypass keyword classification
// and tag every article `spor` so they cluster together and don't
// accidentally land in politics clusters via stray keywords.
const SPORTS_SOURCE_SLUGS: ReadonlySet<string> = new Set([
  "fotomac",
  "fotospor",
  "a-spor",
  "ntv-spor",
  "kontraspor",
  "ajansspor",
]);

// Keyword-based category classification for Turkish news
const CATEGORY_RULES: { category: NewsCategory; keywords: RegExp }[] = [
  {
    category: "son_dakika",
    keywords:
      /son\s*dakika|flaş\s*haber|breaking|acil|sondakika/i,
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

function classifyCategory(
  title: string,
  description: string | null,
  url: string
): NewsCategory {
  const text = `${title} ${description || ""} ${url}`.toLowerCase();

  // Son dakika gets priority. The first rule is statically defined above so
  // it will always exist; the optional-chain keeps the type checker happy
  // under `noUncheckedIndexedAccess` without changing runtime semantics.
  const sonDakikaRule = CATEGORY_RULES[0];
  if (sonDakikaRule && sonDakikaRule.keywords.test(text)) return "son_dakika";

  // Check URL path for category hints
  const urlCategory = detectCategoryFromUrl(url);
  if (urlCategory) return urlCategory;

  // Keyword matching on title + description
  for (const rule of CATEGORY_RULES.slice(1)) {
    if (rule.keywords.test(text)) return rule.category;
  }

  return "genel";
}

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

function extractImage(item: RawFeedItem): string | null {
  // Try structured fields first (fastest, most reliable)
  const fromFields =
    getImageEnclosure(item) ||
    item.mediaContent?.$?.url ||
    item.mediaThumbnail?.$?.url ||
    item.mediaGroup?.["media:content"]?.$?.url ||
    item.mediaGroup?.["media:thumbnail"]?.$?.url ||
    null;

  if (fromFields) return fromFields;

  // Non-standard <image>URL</image> inside <item> (CNN Türk, etc.)
  const itemImg = item.itemImage;
  if (itemImg) {
    const imgUrl = typeof itemImg === "string" ? itemImg : itemImg.url;
    if (imgUrl && isValidImageUrl(imgUrl)) return imgUrl;
  }

  // Fallback: extract first <img src="..."> from HTML content
  const htmlContent = item.contentEncoded || item.content || "";
  if (htmlContent) {
    const imgMatch = htmlContent.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch?.[1] && isValidImageUrl(imgMatch[1])) return imgMatch[1];
  }

  // og:image will be fetched separately in the cron job for remaining nulls
  return null;
}

function getImageEnclosure(item: RawFeedItem): string | null {
  if (!item.enclosure) return null;
  // Atom feeds nest enclosure attributes under $, RSS feeds put them at top level
  const url = item.enclosure.url || item.enclosure.$?.url;
  const type = item.enclosure.type || item.enclosure.$?.type || "";
  if (!url) return null;
  // Some feeds have non-image enclosures (audio/video)
  if (type && !type.startsWith("image/")) return null;
  return url;
}

function isValidImageUrl(url: string): boolean {
  if (!url || url.length < 10) return false;
  // Skip tiny icons, tracking pixels, and data URIs
  if (url.startsWith("data:")) return false;
  if (/favicon|icon|logo|pixel|tracker|1x1|spacer/i.test(url)) return false;
  return true;
}

// Decode XML/HTML named entities that survive rss-parser's own decode pass.
// Some Turkish feeds (haberler.com especially) double-encode: raw feed has
// `&amp;apos;`, rss-parser decodes `&amp;` → `&`, leaving a literal `&apos;`
// in the title that React renders as text. Second pass here catches it.
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
      String.fromCodePoint(parseInt(n, 16))
    );
}

function cleanDescription(raw?: string): string | null {
  if (!raw) return null;
  const text = decodeEntities(raw.replace(/<[^>]*>/g, "")).trim();
  return text.length > 500 ? text.slice(0, 497) + "..." : text || null;
}

function parseDate(raw?: string): string {
  if (!raw) return new Date().toISOString();
  const date = new Date(raw);
  return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
