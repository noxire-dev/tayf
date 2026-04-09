import Link from "next/link";
import { Eye } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { NavLinks } from "@/components/layout/nav-links";

export function Header() {
  return (
    <header className="border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-50">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground shrink-0">
            <Eye className="h-[18px] w-[18px] text-background" />
          </div>
          <div className="flex items-baseline gap-1.5 leading-none">
            <span className="text-base font-bold tracking-tight">Tayf</span>
            <Separator
              orientation="vertical"
              className="h-3 mx-0.5 hidden sm:block"
            />
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              Türkiye Haber Analizi
            </span>
          </div>
        </Link>

        <NavLinks />
      </div>
    </header>
  );
}
