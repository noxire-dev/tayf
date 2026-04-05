import type { BiasDistribution } from "@/types";

const SEGMENTS = [
  { key: "pro_government" as const, color: "bg-red-500", dot: "bg-red-400", label: "Hükümete Yakın" },
  { key: "independent" as const, color: "bg-green-500", dot: "bg-green-400", label: "Bağımsız" },
  { key: "opposition" as const, color: "bg-blue-500", dot: "bg-blue-400", label: "Muhalefet" },
];

export function BiasSpectrum({
  distribution,
}: {
  distribution: BiasDistribution;
}) {
  const total =
    distribution.pro_government +
    distribution.opposition +
    distribution.independent;

  if (total === 0) return null;

  const active = SEGMENTS.filter((s) => distribution[s.key] > 0);

  return (
    <div className="space-y-2">
      {/* Bar */}
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {active.map((segment) => (
          <div
            key={segment.key}
            className={`${segment.color} transition-all duration-500`}
            style={{ width: `${(distribution[segment.key] / total) * 100}%` }}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex gap-3">
        {active.map((segment) => (
          <span key={segment.key} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${segment.dot}`} />
            {segment.label}
            <span className="text-muted-foreground/60">
              {Math.round((distribution[segment.key] / total) * 100)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
