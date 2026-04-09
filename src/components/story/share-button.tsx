"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";

interface ShareButtonProps {
  clusterId: string;
  title: string;
}

export function ShareButton({ clusterId, title }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = `${window.location.origin}/cluster/${clusterId}`;
    // Try native share first (mobile)
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // user cancelled; fall through to clipboard
      }
    }
    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 hover:bg-muted/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      aria-label="Bağlantıyı kopyala"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-500" />
          <span>Kopyalandı</span>
        </>
      ) : (
        <>
          <Share2 className="h-3 w-3" />
          <span>Paylaş</span>
        </>
      )}
    </button>
  );
}
