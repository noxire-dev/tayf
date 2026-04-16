// Source profile loading skeleton. Provides the Suspense boundary for PPR.

export default function SourceProfileLoading() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
      <div className="h-4 w-28 rounded bg-muted/40 animate-pulse" />
      <div className="rounded-xl border border-border/60 bg-card/40 p-6 flex gap-5">
        <div className="h-20 w-20 rounded-lg shrink-0 bg-muted/40 animate-pulse" />
        <div className="flex-1 space-y-3">
          <div className="h-7 w-48 rounded bg-muted/60 animate-pulse" />
          <div className="h-5 w-32 rounded-full bg-muted/40 animate-pulse" />
          <div className="h-3 w-40 rounded bg-muted/30 animate-pulse" />
        </div>
      </div>
      <div className="space-y-3">
        <div className="h-6 w-32 rounded bg-muted/60 animate-pulse" />
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border/60 bg-card/40 p-4 flex gap-3"
          >
            <div className="h-16 w-16 rounded shrink-0 bg-muted/40 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-muted/60 animate-pulse" />
              <div className="h-3 w-full rounded bg-muted/40 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
