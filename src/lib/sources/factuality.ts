/**
 * Hand-tagged factuality + ownership metadata for the top ~30 Turkish outlets
 * Tayf tracks. Closes the biggest absolute gap vs. Ground News (which surfaces
 * factuality + ownership chips on every story). The data here is intentionally
 * conservative — we lean toward `mixed` over `low`/`high` whenever a source
 * has any history of partisan framing or selective reporting, and we use
 * `null` when we don't have a defensible call.
 *
 * Sources are keyed by the same `slug` used in `supabase/seed_sources.sql`
 * (and exposed on the `Source` row from Postgres). When in doubt, check that
 * file — every key here must round-trip to a real source slug.
 *
 * Methodology notes:
 *   - "high"   → wire-style or institutional reporting with consistently
 *                verifiable facts even when framing is partisan. Rare.
 *   - "mixed"  → reliable on hard news but with selective sourcing, partisan
 *                framing, or occasional unsupported claims. The default for
 *                most Turkish dailies regardless of bias.
 *   - "low"    → frequent unsupported claims, conspiracy framing, or known
 *                fabrications. Used very sparingly — we'd rather under-call
 *                this than libel a working newsroom.
 *   - `null`   → not yet rated.
 *
 * Ownership is a short, human-readable string (parent company / family /
 * state). Kept as a free-form `string` rather than an enum so we don't have
 * to migrate the union every time we add an outlet.
 *
 * If you add an entry here, also consider whether the corresponding
 * `<SourceChips slug={...}>` will fit in the consuming layout — the chip
 * component renders nothing for unknown slugs, so partial coverage is safe.
 */

export type Factuality = "high" | "mixed" | "low";

export interface SourceFactualityMetadata {
  /** Editorial fact-checking track record. `null` = not yet rated. */
  factuality: Factuality | null;
  /** Parent organization / owner family / state. `null` = unknown. */
  ownership: string | null;
}

export const SOURCE_METADATA: Record<string, SourceFactualityMetadata> = {
  // ── State media ────────────────────────────────────────────────────────
  // Turkish state outlets — Anadolu Ajansı and TRT are wire-style on hard
  // facts (dates, names, statements) but openly editorial on framing. We
  // call this "high" on factuality with a state-ownership label so the
  // chip surfaces both signals at once.
  "anadolu-ajansi": {
    factuality: "high",
    ownership: "Devlet (Türkiye Cumhuriyeti)",
  },
  "trt-haber": {
    factuality: "high",
    ownership: "Devlet (TRT)",
  },
  "trt-world": {
    factuality: "high",
    ownership: "Devlet (TRT)",
  },
  "daily-sabah": {
    // English-language state-aligned daily, owned by the Turkuvaz group
    // (which itself is in the pro-government conglomerate orbit).
    factuality: "mixed",
    ownership: "Turkuvaz Medya (hükümete yakın)",
  },
  "a-news": {
    factuality: "mixed",
    ownership: "Turkuvaz Medya (hükümete yakın)",
  },

  // ── Pro-government conglomerate press ─────────────────────────────────
  // Turkuvaz Medya (Kalyon Group) — Sabah, A Haber, Takvim, Fotomaç.
  sabah: {
    factuality: "mixed",
    ownership: "Turkuvaz Medya (Kalyon Grubu)",
  },
  "a-haber": {
    factuality: "mixed",
    ownership: "Turkuvaz Medya (Kalyon Grubu)",
  },
  takvim: {
    factuality: "mixed",
    ownership: "Turkuvaz Medya (Kalyon Grubu)",
  },
  fotomac: {
    factuality: "mixed",
    ownership: "Turkuvaz Medya (Kalyon Grubu)",
  },
  // Albayrak Group — Yeni Şafak, Star, GZT.
  "yeni-safak": {
    factuality: "mixed",
    ownership: "Albayrak Grubu",
  },
  star: {
    factuality: "mixed",
    ownership: "Albayrak Grubu",
  },
  // İhlas Holding — Türkiye Gazetesi, TGRT Haber, İHA.
  "turkiye-gazetesi": {
    factuality: "mixed",
    ownership: "İhlas Holding",
  },
  "tgrt-haber": {
    factuality: "mixed",
    ownership: "İhlas Holding",
  },
  iha: {
    factuality: "mixed",
    ownership: "İhlas Holding",
  },
  // Yeni Akit — independently held but consistently aligned with the
  // governing coalition's hardline wing. Track record on factuality is
  // weaker than the conglomerate dailies; we still hold to "mixed" rather
  // than "low" out of conservatism.
  "yeni-akit": {
    factuality: "mixed",
    ownership: "Bağımsız (hükümete yakın)",
  },

  // ── Gov-leaning mainstream (Demirören + others) ───────────────────────
  // Demirören Medya was the dominant secular conglomerate before the 2018
  // sale; post-sale the group's papers (Hürriyet, Milliyet, Posta, CNN
  // Türk, Fanatik) have visibly tilted toward the government line.
  hurriyet: {
    factuality: "mixed",
    ownership: "Demirören Medya",
  },
  milliyet: {
    factuality: "mixed",
    ownership: "Demirören Medya",
  },
  "cnn-turk": {
    factuality: "mixed",
    ownership: "Demirören Medya",
  },
  posta: {
    factuality: "mixed",
    ownership: "Demirören Medya",
  },
  fanatik: {
    factuality: "mixed",
    ownership: "Demirören Medya",
  },
  // Doğuş Yayın Grubu — NTV, NTV Spor.
  ntv: {
    factuality: "mixed",
    ownership: "Doğuş Yayın Grubu",
  },
  // Ciner Medya — Habertürk, Show TV, Bloomberg HT (Bloomberg is a
  // licensed operation but the local edit is Ciner-run).
  haberturk: {
    factuality: "mixed",
    ownership: "Ciner Medya",
  },
  "bloomberg-ht": {
    factuality: "high",
    ownership: "Ciner Medya (Bloomberg lisansı)",
  },

  // ── Opposition press (independent) ─────────────────────────────────────
  // These outlets are openly opposition-aligned but operate as
  // independent newsrooms (no conglomerate parent). Factuality on hard
  // news is generally solid with partisan framing.
  sozcu: {
    factuality: "mixed",
    ownership: "Bağımsız",
  },
  cumhuriyet: {
    factuality: "mixed",
    ownership: "Bağımsız (Cumhuriyet Vakfı)",
  },
  "halk-tv": {
    factuality: "mixed",
    ownership: "Bağımsız",
  },
  tele1: {
    factuality: "mixed",
    ownership: "Bağımsız",
  },
  birgun: {
    factuality: "mixed",
    ownership: "Bağımsız (BirGün Kooperatifi)",
  },
  evrensel: {
    factuality: "mixed",
    ownership: "Bağımsız",
  },

  // ── Independent / center ──────────────────────────────────────────────
  // Smaller independent newsrooms — fact-driven but operating on tight
  // budgets, so coverage breadth is uneven. Factuality solid where they
  // do report.
  t24: {
    factuality: "high",
    ownership: "Bağımsız",
  },
  diken: {
    factuality: "mixed",
    ownership: "Bağımsız",
  },
  medyascope: {
    factuality: "high",
    ownership: "Bağımsız",
  },
  "gazete-duvar": {
    factuality: "mixed",
    ownership: "Bağımsız",
  },
  bianet: {
    factuality: "high",
    ownership: "Bağımsız (IPS İletişim Vakfı)",
  },

  // ── International ──────────────────────────────────────────────────────
  // Public broadcasters and foreign-funded Turkish-language services.
  // BBC and DW are public, editorially independent, and have strong
  // factuality records. Sputnik and CGTN are state media for foreign
  // governments — we mark factuality "mixed" to reflect their selective
  // sourcing while being explicit about ownership.
  "bbc-turkce": {
    factuality: "high",
    ownership: "BBC (Birleşik Krallık kamu yayıncısı)",
  },
  "dw-turkce": {
    factuality: "high",
    ownership: "Deutsche Welle (Almanya kamu yayıncısı)",
  },
  "euronews-turkce": {
    factuality: "high",
    ownership: "Euronews (Alpac Capital)",
  },
  "voa-turkce": {
    factuality: "high",
    ownership: "Voice of America (ABD federal)",
  },
  "sputnik-turkce": {
    factuality: "mixed",
    ownership: "Rossiya Segodnya (Rusya devleti)",
  },
  "cgtn-turk": {
    factuality: "mixed",
    ownership: "CGTN (Çin devleti)",
  },
  "independent-turkce": {
    factuality: "mixed",
    ownership: "Independent Türkçe (SRMG lisansı)",
  },
};

/**
 * Convenience accessor used by `<SourceChips>`. Returns `null` for slugs we
 * haven't tagged yet, so the chip component can no-op cleanly.
 */
export function getSourceMetadata(
  slug: string,
): SourceFactualityMetadata | null {
  return SOURCE_METADATA[slug] ?? null;
}
