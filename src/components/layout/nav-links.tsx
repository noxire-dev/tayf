"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Telescope, Eye, Settings } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const baseLink =
  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors";
const inactive =
  "text-foreground/80 hover:text-foreground hover:bg-muted/50";
const active = "bg-foreground/10 text-foreground font-medium";

export function NavLinks() {
  const pathname = usePathname();

  const isHome = pathname === "/";
  const isBlindspots = pathname?.startsWith("/blindspots") ?? false;
  const isAdmin = pathname?.startsWith("/admin") ?? false;

  return (
    <nav className="flex items-center gap-1 text-[13px]">
      <Link
        href="/"
        aria-current={isHome ? "page" : undefined}
        className={`${baseLink} ${isHome ? active : inactive}`}
      >
        <Telescope className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Haberler</span>
      </Link>
      <Separator orientation="vertical" className="h-3 mx-0.5" />
      <Link
        href="/blindspots"
        aria-current={isBlindspots ? "page" : undefined}
        className={`${baseLink} ${isBlindspots ? active : inactive}`}
      >
        <Eye className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Kör Noktalar</span>
      </Link>
      <Separator orientation="vertical" className="h-3 mx-0.5" />
      <Link
        href="/admin"
        aria-current={isAdmin ? "page" : undefined}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors ${
          isAdmin
            ? active
            : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/50"
        }`}
      >
        <Settings className="h-3.5 w-3.5" />
        <span className="sr-only">Admin</span>
      </Link>
    </nav>
  );
}
