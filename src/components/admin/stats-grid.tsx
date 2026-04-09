import { StatCard } from "./stat-card";
import { Newspaper, Building2, Layers, ImageOff } from "lucide-react";

export function StatsGrid({
  articles,
  sources,
  clusters,
  missingImages,
}: {
  articles: number;
  sources: number;
  clusters: number;
  missingImages: number;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      <StatCard icon={Newspaper} label="Haberler" value={articles} />
      <StatCard icon={Building2} label="Kaynaklar" value={sources} />
      <StatCard icon={Layers} label="Kümeler" value={clusters} />
      <StatCard
        icon={ImageOff}
        label="Görselsiz"
        value={missingImages}
        variant={missingImages ? "warning" : "default"}
      />
    </div>
  );
}
