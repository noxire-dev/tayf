import { createServerClient } from "@/lib/supabase/server";
import { ArticleFeed } from "@/components/story/article-feed";
import { Separator } from "@/components/ui/separator";
import type { Article } from "@/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let articles: Article[] = [];

  try {
    const supabase = createServerClient();
    const result = await supabase
      .from("articles")
      .select("*, source:sources!inner(*)")
      .eq("source.active", true)
      .order("published_at", { ascending: false })
      .limit(120);
    articles = (result.data as Article[]) || [];
  } catch {
    // Supabase not configured yet
  }

  return (
    <div className="container mx-auto px-4 py-5">
      {/* Hero */}
      <section className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Türkiye Haberleri</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Farklı kaynaklardan haberleri karşılaştırın, medya yanlılığını görün.
        </p>
      </section>

      <Separator className="mb-5" />

      {/* Feed */}
      {articles.length > 0 ? (
        <ArticleFeed articles={articles} />
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-8 max-w-md">
            <p className="text-sm font-medium mb-1">Henüz haber yok</p>
            <p className="text-xs text-muted-foreground">
              RSS beslemelerini çekmek için{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">
                /api/cron/ingest
              </code>{" "}
              endpoint&apos;ini çalıştırın.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
