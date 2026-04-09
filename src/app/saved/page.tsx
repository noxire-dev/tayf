"use client";
import { useBookmarks } from "@/components/bookmark/use-bookmarks";
import Link from "next/link";

export default function SavedPage() {
  const { ids, count } = useBookmarks();
  // Render the list as simple links — no DB join needed for this MVP.
  // The actual cluster titles will be fetched lazily by the cluster detail page.
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
        Kaydedilenler
      </h1>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">
          Henüz hiçbir hikâye kaydetmediniz. Hikâye kartlarındaki yer imi
          ikonuna dokunun.
        </p>
      ) : (
        <ul className="space-y-2">
          {Array.from(ids).map((id) => (
            <li key={id}>
              <Link
                href={`/cluster/${id}`}
                className="text-sm text-foreground hover:underline"
              >
                /cluster/{id.slice(0, 8)}…
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
