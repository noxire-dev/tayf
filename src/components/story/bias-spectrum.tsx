import type { AlignmentDistribution } from "@/types";

const SEGMENTS = [
  { key: "pro_government" as const, color: "bg-red-600", dot: "bg-red-500", label: "İktidar" },
  { key: "gov_leaning" as const, color: "bg-red-400", dot: "bg-red-300", label: "İktidara Yakın" },
  { key: "center" as const, color: "bg-emerald-500", dot: "bg-emerald-400", label: "Merkez" },
  { key: "opposition_leaning" as const, color: "bg-blue-400", dot: "bg-blue-300", label: "Muhalefete Yakın" },
  { key: "opposition" as const, color: "bg-blue-600", dot: "bg-blue-500", label: "Muhalefet" },
];

export function AlignmentSpectrum({
  distribution,
}: {
  distribution: AlignmentDistribution;
}) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);

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
      <div className="flex flex-wrap gap-3">
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
