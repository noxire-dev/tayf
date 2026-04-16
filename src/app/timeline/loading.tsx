// Timeline route loading skeleton. Provides the Suspense boundary for PPR.

export default function TimelineLoading() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
      <div className="space-y-2">
        <div className="h-4 w-32 rounded bg-muted/60 animate-pulse" />
        <div className="h-8 w-52 rounded bg-muted/60 animate-pulse" />
        <div className="h-4 w-80 rounded bg-muted/40 animate-pulse" />
      </div>
      <div className="space-y-8 border-l-2 border-muted/20 pl-6 ml-2">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-3">
            <div className="h-4 w-28 rounded bg-muted/50 animate-pulse" />
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, j) => (
                <div
                  key={j}
                  className="flex items-center gap-3 rounded-lg ring-1 ring-border/60 bg-card/40 px-3 py-2"
                >
                  <div className="h-3 w-10 rounded bg-muted/40 animate-pulse shrink-0" />
                  <div className="h-4 flex-1 rounded bg-muted/50 animate-pulse" />
                  <div className="h-3 w-16 rounded bg-muted/30 animate-pulse shrink-0" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
