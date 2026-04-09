export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl space-y-5">
      {/* Hero skeleton */}
      <div className="space-y-3 pb-2">
        <div className="h-3 w-32 rounded bg-muted/60 animate-pulse" />
        <div className="h-10 w-64 rounded bg-muted/80 animate-pulse" />
        <div className="h-4 w-full max-w-xl rounded bg-muted/50 animate-pulse" />
      </div>

      {/* Search bar skeleton */}
      <div className="h-10 w-full rounded-full bg-muted/40 animate-pulse" />

      {/* Cluster card skeletons */}
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl ring-1 ring-border/60 bg-card/60 p-5 flex gap-4 animate-pulse"
          >
            <div className="h-28 w-40 rounded-lg bg-muted/50 shrink-0" />
            <div className="flex-1 space-y-3">
              <div className="h-5 w-3/4 rounded bg-muted/70" />
              <div className="h-3 w-1/2 rounded bg-muted/40" />
              <div className="h-2 w-full rounded-full bg-muted/40" />
              <div className="space-y-1.5 mt-2">
                <div className="h-2.5 w-11/12 rounded bg-muted/30" />
                <div className="h-2.5 w-10/12 rounded bg-muted/30" />
                <div className="h-2.5 w-9/12 rounded bg-muted/30" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
