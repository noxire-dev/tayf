// supabase/functions/_shared/cluster/entities.ts
//
// Lightweight entity extractor for Turkish news titles+descriptions.
// Ported from `scripts/lib/cluster/entities.mjs`.
//
// Emits single-token canonical forms from a curated whitelist, 4-digit
// years, and percentages. Includes an EN→TR bilingual bridge for a-news /
// daily-sabah / hurriyet-daily-news / trt-world.

// ---------------------------------------------------------------------------
// POLITICAL_ENTITIES — curated single-token whitelist (TR-folded lowercase).
// ---------------------------------------------------------------------------

export const POLITICAL_ENTITIES: Set<string> = new Set([
  // Parties
  "akp", "chp", "mhp", "iyi", "deva", "gelecek", "saadet", "tip", "dem",
  "hdp", "ysp", "yrp", "bbp", "vatan",
  // Institutions
  "tbmm", "meclis", "cumhurbaskanligi", "basbakanlik", "disisleri", "icisleri",
  "adalet", "meb", "saglik", "tcmb", "bddk", "spk", "tuik", "tusiad", "afad",
  "tsk", "emniyet", "jandarma", "myk", "ysk", "danistay", "anayasamahkemesi",
  "yargitay", "sayistay",
  // Cities (largest only)
  "istanbul", "ankara", "izmir", "bursa", "adana", "gaziantep", "konya",
  "antalya", "diyarbakir", "sanliurfa", "kayseri", "mersin", "samsun", "trabzon",
  // Countries / blocs frequent in TR news
  "abd", "rusya", "ukrayna", "suriye", "iran", "israil", "filistin",
  "yunanistan", "almanya", "fransa", "ingiltere", "cin", "avrupa", "nato",
  "bm", "ab", "ohal",
  // Known people (canonical diacritic-folded single tokens)
  "erdogan", "kilicdaroglu", "ozel", "imamoglu", "yavas", "bahceli",
  "davutoglu", "babacan", "karamollaoglu", "akgun", "simsek", "sonmez",
  "fidan", "yilmaz", "ala", "guler",
  // Sports → political bridges
  "galatasaray", "fenerbahce", "besiktas", "trabzonspor", "tff", "spor", "futbol",
  // Religion → political bridges
  "diyanet", "imam", "cami", "cuma", "namaz", "ramazan", "oruc", "kuran",
  // Finance → political bridges
  "bist", "borsa", "dolar", "euro", "enflasyon", "faiz", "kur", "altin",
  // Armenian / minority bridges
  "ermeni", "rum", "gregoryen", "patrik", "hrant", "dink",
  // English-language bridges for a-news
  "turkey", "turkish", "parliament", "minister", "president", "election",
  "trump", "putin", "biden",
  // EN→TR bridge targets
  "turkiye", "bakan", "cumhurbaskan", "secim", "ekonomi", "muhalefet",
]);

// ---------------------------------------------------------------------------
// Stopwords — small list of high-frequency Turkish tokens that the 3-char
// length filter would otherwise miss.
// ---------------------------------------------------------------------------

const STOPWORDS: Set<string> = new Set([
  "ile", "icin", "gibi", "kadar", "daha", "cok", "her", "hem", "bir", "iki",
  "uc", "bin", "son", "dun", "bugun", "yarin", "simdi", "sonra", "once",
  "var", "yok", "oldu", "dedi", "diye", "ama", "fakat", "ancak", "veya",
  "den", "dan", "nin", "nun", "haber", "canli", "flas", "acil",
]);

// ---------------------------------------------------------------------------
// Turkish folding map.
// ---------------------------------------------------------------------------

function foldTurkish(s: string): string {
  const map: Record<string, string> = {
    ş: "s", Ş: "s",
    ı: "i", İ: "i", I: "i",
    ü: "u", Ü: "u",
    ö: "o", Ö: "o",
    ç: "c", Ç: "c",
    ğ: "g", Ğ: "g",
    â: "a", Â: "a",
    î: "i", Î: "i",
    û: "u", Û: "u",
  };
  let out = "";
  for (const ch of s) out += map[ch] ?? ch;
  return out.toLowerCase();
}

export function normalizeToken(raw: unknown): string | null {
  if (raw == null) return null;
  const folded = foldTurkish(String(raw));
  const stripped = folded.replace(/[^a-z0-9]/g, "");
  if (stripped.length < 3) return null;
  if (STOPWORDS.has(stripped)) return null;
  return stripped;
}

// Split on whitespace + common Turkish punctuation.
const TOKEN_SPLIT_RE = /[\s.,;:!?()[\]{}"'`’‘“”«»\-–—/\\|…]+/;

// ---------------------------------------------------------------------------
// EN_TO_TR_BRIDGE — emit Turkish equivalents from English-titled wires so
// `a-news` etc. share entity tokens with mainstream Turkish coverage.
// ---------------------------------------------------------------------------

export const EN_TO_TR_BRIDGE: Record<string, string> = {
  turkey: "turkiye",
  istanbul: "istanbul",
  ankara: "ankara",
  erdogan: "erdogan",
  parliament: "meclis",
  minister: "bakan",
  president: "cumhurbaskan",
  election: "secim",
  economy: "ekonomi",
  "central bank": "tcmb",
  opposition: "muhalefet",
};

const EN_BRIDGE_PATTERNS: Array<{ re: RegExp; tr: string }> = Object.entries(
  EN_TO_TR_BRIDGE,
).map(([en, tr]) => {
  const escaped = en
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return {
    re: new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i"),
    tr,
  };
});

export function extractEntities(text: string | null | undefined): string[] {
  if (!text || typeof text !== "string") return [];

  const found = new Set<string>();

  // 1–2. Whitelist matches over normalized single tokens.
  const rawTokens = text.split(TOKEN_SPLIT_RE);
  for (const raw of rawTokens) {
    if (!raw) continue;
    const norm = normalizeToken(raw);
    if (!norm) continue;
    if (POLITICAL_ENTITIES.has(norm)) {
      found.add(norm);
    }
  }

  // 3. 4-digit years (1950-2099).
  const yearRe = /\b(19[5-9]\d|20\d{2})\b/g;
  let ym: RegExpExecArray | null;
  while ((ym = yearRe.exec(text)) !== null) {
    found.add(ym[1]);
  }

  // 4. Percentages: "47%" / "47 %" / "yüzde 47".
  const pctRe = /(?:\b(\d{1,3})\s*%|(?:yüzde|yuzde)\s*(\d{1,3})\b)/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pctRe.exec(text)) !== null) {
    const num = pm[1] || pm[2];
    if (num) found.add(`pct${num}`);
  }

  // 5. Bilingual bridge.
  for (const { re, tr } of EN_BRIDGE_PATTERNS) {
    if (re.test(text)) {
      found.add(tr);
    }
  }

  return [...found];
}
