// scripts/lib/shared/llm-headlines.mjs
//
// LLM-powered cluster headline rewriter.
//
// A3 audit found 46% of seed cluster titles fail clarity/neutrality checks
// and 38% leak the source's tone. This helper produces a neutral, factual
// aggregator title for a cluster by asking Claude Haiku to summarize the
// member headlines into a single Turkish line.
//
// Cost (per A3): <$1/mo on claude-haiku-4-5.
//
// Caller (the cluster worker — H2's territory) is responsible for:
//   - deciding when to call this
//   - handling fallback if it throws (e.g. fall back to title_tr)
//
// This module talks to the Anthropic REST API via built-in fetch() to
// avoid pulling in @anthropic-ai/sdk as a new dependency.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

/**
 * Rewrite a cluster's headline as a neutral, factual, <80 char Turkish title.
 * Uses Anthropic API directly (no SDK to avoid a new dependency).
 *
 * @param {Object} cluster - { title_tr, summary_tr?, member_titles: string[] }
 * @returns {Promise<string>} the rewritten neutral title
 */
export async function rewriteClusterHeadline(cluster) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const memberTitles = (cluster.member_titles || [])
    .slice(0, 8)
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");

  const prompt = `Aşağıda 8 farklı Türk haber kaynağının aynı haber için yazdığı başlıklar var. Bu haberleri toplu bir tarafsız başlığa indirgemen gerekiyor.

KURALLAR:
- En fazla 80 karakter
- Tarafsız, olgusal, sıfat içermeyen
- Hiçbir kaynağın tonunu kopyalama
- Açık şekilde olayı anlat
- "Şok!", "Son dakika!", "Kahreden..." gibi clickbait yasak
- Türkçe olmalı
- Sadece başlığı yaz, başka açıklama yok

KAYNAK BAŞLIKLARI:
${memberTitles}

TARAFSIZ TOPLU BAŞLIK:`;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 100,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text?.trim();
  if (!text) throw new Error("Empty response from Anthropic");

  // Strip quote marks if the model added them
  return text.replace(/^["'""']|["'""']$/g, "").trim();
}

// Inline self-test (only when ANTHROPIC_API_KEY is set + SELF_TEST=1)
if (
  import.meta.url === `file://${process.argv[1]}` &&
  process.env.SELF_TEST === "1"
) {
  const sample = {
    title_tr: "İmamoğlu'na destek neden düştü?",
    member_titles: [
      "İmamoğlu'na destek neden düştü?",
      "İmamoğlu için kötü haber: Anketler düşüyor",
      "Son anket: İmamoğlu'na destek erimekte",
      "İBB Başkanı'nın oy oranı 4 puan geriledi",
    ],
  };
  rewriteClusterHeadline(sample)
    .then((t) => console.log("REWRITTEN:", t))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
