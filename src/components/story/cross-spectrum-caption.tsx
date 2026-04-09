import { Zap } from "lucide-react";

export function CrossSpectrumCaption({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  const cleanLines = lines.map((l) => l.replace(/^⚡\s*/, ""));
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3">
      <Zap
        className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-500 mt-0.5"
        strokeWidth={2.75}
      />
      <div className="space-y-1 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-yellow-700 dark:text-yellow-400">
          Sürpriz kesişimler
        </p>
        {cleanLines.map((line, i) => (
          <p
            key={i}
            className="text-[11px] leading-relaxed text-yellow-600 dark:text-yellow-500/80"
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
