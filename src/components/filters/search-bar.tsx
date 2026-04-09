"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

export function SearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(searchParams.get("q") ?? "");

  // Global `/` shortcut focuses the input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Debounced URL update (300ms)
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set("q", value.trim());
      } else {
        params.delete("q");
      }
      const query = params.toString();
      startTransition(() => {
        router.push(`${pathname}${query ? "?" + query : ""}`);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [value, pathname, router, searchParams]);

  return (
    <div className="relative flex items-center">
      <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Haberlerde ara..."
        className="h-10 w-full rounded-full bg-muted/50 border border-border/60 pl-9 pr-12 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:bg-background transition-colors"
      />
      <kbd className="absolute right-3 hidden sm:inline-flex items-center justify-center rounded border border-border/60 bg-muted/40 px-1.5 text-[10px] text-muted-foreground font-mono">
        /
      </kbd>
    </div>
  );
}
