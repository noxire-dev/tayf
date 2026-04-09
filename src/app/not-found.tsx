import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="container mx-auto px-4 py-24 max-w-lg">
      <div className="flex flex-col items-center text-center space-y-4">
        <div className="h-14 w-14 rounded-full border border-border/60 bg-muted/40 flex items-center justify-center">
          <Compass className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Sayfa bulunamadı</h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-md">
          Aradığınız sayfa taşınmış, silinmiş veya hiç var olmamış olabilir.
          Haberlere dönüp devam edin.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors"
        >
          Ana sayfaya dön
        </Link>
      </div>
    </div>
  );
}
