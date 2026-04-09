export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-6">
      {/* Back nav skeleton */}
      <div className="h-3 w-16 rounded bg-muted/40 animate-pulse" />

      {/* Hero skeleton */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-4 animate-pulse">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="h-48 sm:h-56 w-full sm:w-80 rounded-lg bg-muted/50 shrink-0" />
          <div className="flex-1 space-y-3">
            <div className="h-8 w-full rounded bg-muted/70" />
            <div className="h-8 w-4/5 rounded bg-muted/70" />
            <div className="flex gap-2 pt-1">
              <div className="h-5 w-20 rounded-full bg-muted/40" />
              <div className="h-5 w-16 rounded-full bg-muted/40" />
            </div>
            <div className="h-2 w-full rounded-full bg-muted/40 mt-3" />
          </div>
        </div>
      </div>

      {/* Stance card skeleton */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-3 animate-pulse">
        <div className="h-4 w-40 rounded bg-muted/70" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border/40 bg-card/30 p-3 space-y-2">
            <div className="h-3 w-24 rounded bg-muted/50" />
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="h-5 w-24 rounded-full bg-muted/40" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
