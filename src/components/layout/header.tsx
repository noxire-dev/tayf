import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { NavLinks } from "@/components/layout/nav-links";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/90 backdrop-blur-xl">
      {/* Thin brand accent line at the very top */}
      <div className="h-[2px] bg-gradient-to-r from-red-500/80 via-brand to-emerald-500/80" />

      <div className="container mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-3">
          {/* Logo mark — spectrum bars */}
          <div className="flex gap-[2px] h-7 items-end shrink-0">
            <div className="w-[3px] h-3 rounded-full bg-red-500/70 group-hover:h-5 transition-all duration-300" />
            <div className="w-[3px] h-5 rounded-full bg-brand/80 group-hover:h-7 transition-all duration-300" />
            <div className="w-[3px] h-4 rounded-full bg-emerald-500/70 group-hover:h-6 transition-all duration-300" />
          </div>
          <div className="flex items-baseline gap-2 leading-none">
            <span className="font-serif text-xl font-normal tracking-tight">
              Tayf
            </span>
            <Separator
              orientation="vertical"
              className="h-3.5 mx-0 hidden sm:block bg-border/40"
            />
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground hidden sm:inline uppercase">
              Haber Analizi
            </span>
          </div>
        </Link>

        <NavLinks />
      </div>
    </header>
  );
}
