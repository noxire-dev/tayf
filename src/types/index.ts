export type AlignmentCategory =
  | "pro_government"
  | "gov_leaning"
  | "center"
  | "opposition_leaning"
  | "opposition";

export type TraditionCategory =
  | "mainstream"
  | "islamist"
  | "nationalist"
  | "secular"
  | "left"
  | "kurdish"
  | "state"
  | "international";

export type SourceType = "general" | "sports" | "finance" | "niche";

export type NewsCategory =
  | "son_dakika"
  | "politika"
  | "dunya"
  | "ekonomi"
  | "spor"
  | "teknoloji"
  | "yasam"
  | "genel";

export const NEWS_CATEGORIES: Record<NewsCategory, { label: string; icon: string }> = {
  son_dakika: { label: "Son Dakika", icon: "Zap" },
  politika: { label: "Politika", icon: "Landmark" },
  dunya: { label: "Dünya", icon: "Globe" },
  ekonomi: { label: "Ekonomi", icon: "TrendingUp" },
  spor: { label: "Spor", icon: "Trophy" },
  teknoloji: { label: "Teknoloji", icon: "Cpu" },
  yasam: { label: "Yaşam", icon: "Heart" },
  genel: { label: "Genel", icon: "Newspaper" },
};

export const ALIGNMENT_META: Record<AlignmentCategory, { label: string; color: string }> = {
  pro_government: { label: "İktidar", color: "red-600" },
  gov_leaning: { label: "İktidara Yakın", color: "red-400" },
  center: { label: "Merkez", color: "emerald-500" },
  opposition_leaning: { label: "Muhalefete Yakın", color: "blue-400" },
  opposition: { label: "Muhalefet", color: "blue-600" },
};

export const TRADITION_META: Record<TraditionCategory, { label: string }> = {
  mainstream: { label: "Ana Akım" },
  islamist: { label: "İslamcı" },
  nationalist: { label: "Milliyetçi" },
  secular: { label: "Laik" },
  left: { label: "Sol" },
  kurdish: { label: "Kürt" },
  state: { label: "Devlet" },
  international: { label: "Uluslararası" },
};

export const SOURCE_TYPE_META: Record<SourceType, { label: string }> = {
  general: { label: "Genel Haber" },
  sports: { label: "Spor" },
  finance: { label: "Finans" },
  niche: { label: "Niş" },
};

export interface Source {
  id: string;
  name: string;
  slug: string;
  url: string;
  rss_url: string;
  alignment: AlignmentCategory;
  tradition: TraditionCategory;
  source_type: SourceType;
  logo_url: string | null;
  active: boolean;
}

export interface Article {
  id: string;
  source_id: string;
  title: string;
  description: string | null;
  url: string;
  image_url: string | null;
  published_at: string;
  content_hash: string;
  category: NewsCategory;
  created_at: string;
  source?: Source;
}

export interface AlignmentDistribution {
  pro_government: number;
  gov_leaning: number;
  center: number;
  opposition_leaning: number;
  opposition: number;
}

export interface Cluster {
  id: string;
  title_tr: string;
  title_en: string;
  summary_tr: string;
  summary_en: string;
  bias_distribution: AlignmentDistribution;
  is_blindspot: boolean;
  blindspot_side: AlignmentCategory | null;
  article_count: number;
  first_published: string;
  created_at: string;
  updated_at: string;
  articles?: Article[];
}
