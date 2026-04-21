"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// The admin panel intentionally isn't listed here — it's behind a login
// and shouldn't advertise itself to normal visitors via the ? help popup.
// Admins can still type /admin directly; if session is missing they get
// redirected to /admin/login.
const SHORTCUTS = [
  { keys: ["g", "h"], label: "Ana sayfa", href: "/" },
  { keys: ["g", "b"], label: "Kör noktalar", href: "/blindspots" },
  { keys: ["g", "s"], label: "Kaynaklar", href: "/sources" },
];

export function KbdShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const isTypingTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (isTypingTarget(e.target)) return;

      // ? opens help
      if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      // Esc closes help
      if (e.key === "Escape") {
        setHelpOpen(false);
        setPendingKey(null);
        return;
      }

      // Two-key sequences starting with g
      if (pendingKey === "g") {
        const match = SHORTCUTS.find((s) => s.keys[1] === e.key.toLowerCase());
        if (match) {
          e.preventDefault();
          router.push(match.href);
        }
        setPendingKey(null);
        return;
      }

      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setPendingKey("g");
        setTimeout(() => setPendingKey(null), 1000); // timeout
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pendingKey, router, isTypingTarget]);

  if (!helpOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="rounded-xl border border-border bg-card p-6 shadow-lg max-w-xs w-full mx-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">Klavye kısayolları</h2>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.href} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{s.label}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between text-xs pt-1 border-t border-border/30">
            <span className="text-muted-foreground">Ara</span>
            <kbd className="inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">/</kbd>
          </li>
          <li className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Yardım</span>
            <kbd className="inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">?</kbd>
          </li>
        </ul>
      </div>
    </div>
  );
}
