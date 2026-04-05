import Link from "next/link";
import { Eye, Telescope, Building2, Settings } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export function Header() {
  return (
    <header className="border-b border-border/50 bg-background/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto flex h-12 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground">
            <Eye className="h-4 w-4 text-background" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold tracking-tight">Tayf</span>
            <Separator orientation="vertical" className="h-3 mx-0.5 hidden sm:block" />
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              Türkiye Haber Analizi
            </span>
          </div>
        </Link>

        <nav className="flex items-center gap-1 text-[13px]">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Telescope className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Haberler</span>
          </Link>
          <Link
            href="/blindspots"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Kör Noktalar</span>
          </Link>
          <Link
            href="/sources"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Building2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Kaynaklar</span>
          </Link>
          <Separator orientation="vertical" className="h-3 mx-0.5" />
          <Link
            href="/admin"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
        </nav>
      </div>
    </header>
  );
}
