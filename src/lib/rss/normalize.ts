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
  const title = (item.title || "").trim();
  const url = (item.link || "").trim();
  const description = cleanDescription(item.contentSnippet || item.content);
  const imageUrl = extractImage(item);
  const publishedAt = parseDate(item.isoDate || item.pubDate);
  const contentHash = SHA256(title + url).toString();
  const category = classifyCategory(title, description, url);

  return {
    source_id: source.id,
    title,
    description,
    url,
    image_url: imageUrl,
    published_at: publishedAt,
    content_hash: contentHash,
    category,
  };
}

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
  if (!item.enclosure?.url) return null;
  // Some feeds have non-image enclosures (audio/video)
  const type = item.enclosure.type || "";
  if (type && !type.startsWith("image/")) return null;
  return item.enclosure.url;
}

function isValidImageUrl(url: string): boolean {
  if (!url || url.length < 10) return false;
  // Skip tiny icons, tracking pixels, and data URIs
  if (url.startsWith("data:")) return false;
  if (/favicon|icon|logo|pixel|tracker|1x1|spacer/i.test(url)) return false;
  return true;
}

function cleanDescription(raw?: string): string | null {
  if (!raw) return null;
  const text = raw.replace(/<[^>]*>/g, "").trim();
  return text.length > 500 ? text.slice(0, 497) + "..." : text || null;
}

function parseDate(raw?: string): string {
  if (!raw) return new Date().toISOString();
  const date = new Date(raw);
  return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
