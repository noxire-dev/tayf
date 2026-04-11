"use client";
import { useBookmarks } from "@/components/bookmark/use-bookmarks";
import Link from "next/link";

export default function SavedPage() {
  const { ids, count } = useBookmarks();
  // Render the list as simple links — no DB join needed for this MVP.
  // The actual cluster titles will be fetched lazily by the cluster detail page.
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight mb-4">
        Kaydedilenler
      </h1>
      {count === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-8 text-center space-y-4 animate-fade-up">
          {/* Mini spectrum bar — mirrors the header logo mark */}
          <div className="flex items-center justify-center gap-1">
            <div className="h-4 w-1.5 rounded-full bg-red-500/70" />
            <div className="h-4 w-1.5 rounded-full bg-brand/80" />
            <div className="h-4 w-1.5 rounded-full bg-emerald-500/70" />
          </div>
          <h2 className="font-serif text-lg font-semibold tracking-tight">
            Henuz kaydettiginiz bir hikaye yok
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Hikaye kartlarindaki yer imi ikonuna dokunarak
            <span className="text-brand font-medium"> favorilerinizi kaydedin</span>.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {Array.from(ids).map((id, i) => (
            <li
              key={id}
              className={`animate-fade-up stagger-${Math.min(i + 1, 8)}`}
            >
              <Link
                href={`/cluster/${id}`}
                className="block rounded-lg ring-1 ring-border/60 hover:ring-border bg-card/60 hover:bg-card/80 transition-all p-3 text-sm text-foreground hover-lift"
              >
                /cluster/{id.slice(0, 8)}...
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
