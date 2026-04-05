export type BiasCategory = "pro_government" | "opposition" | "independent";

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

export interface Source {
  id: string;
  name: string;
  slug: string;
  url: string;
  rss_url: string;
  bias: BiasCategory;
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

export interface BiasDistribution {
  pro_government: number;
  opposition: number;
  independent: number;
}

export interface Cluster {
  id: string;
  title_tr: string;
  title_en: string;
  summary_tr: string;
  summary_en: string;
  bias_distribution: BiasDistribution;
  is_blindspot: boolean;
  blindspot_side: BiasCategory | null;
  article_count: number;
  first_published: string;
  created_at: string;
  updated_at: string;
  articles?: Article[];
}
