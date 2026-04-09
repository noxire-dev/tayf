import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ActionRow } from "./action-row";
import {
  RefreshCw,
  Trash2,
  Image,
  AlertTriangle,
} from "lucide-react";

export function QuickActionsCard({
  missingImages,
  actionLoading,
  onRun,
  onConfirmAndRun,
}: {
  missingImages: number;
  actionLoading: string | null;
  onRun: (action: string) => void;
  onConfirmAndRun: (action: string, label: string) => void;
}) {
  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Hızlı İşlemler</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ActionRow
          icon={RefreshCw}
          title="RSS Beslemelerini Çek"
          description="Tüm aktif kaynaklardan haberleri çeker ve veritabanına kaydeder"
          buttonLabel="Çek"
          buttonVariant="default"
          loading={actionLoading === "ingest"}
          onClick={() => onRun("ingest")}
        />
        <Separator />
        <ActionRow
          icon={Image}
          title="Görselleri Tamamla"
          description={`Görseli olmayan ${missingImages} haber için og:image çeker`}
          buttonLabel="Tamamla"
          buttonVariant="default"
          loading={actionLoading === "backfill_images"}
          onClick={() => onRun("backfill_images")}
        />
        <Separator />
        <ActionRow
          icon={Trash2}
          title="Kümeleri Sil"
          description="Tüm haber kümelerini siler, haberler korunur"
          buttonLabel="Kümeleri Sil"
          buttonVariant="destructive"
          loading={actionLoading === "nuke_clusters"}
          onClick={() => onConfirmAndRun("nuke_clusters", "Tüm kümeler silinecek.")}
        />
        <Separator />
        <ActionRow
          icon={AlertTriangle}
          title="Tüm Haberleri Sil"
          description="Tüm haberleri ve kümeleri siler. Kaynaklar korunur."
          buttonLabel="Hepsini Sil"
          buttonVariant="destructive"
          loading={actionLoading === "nuke_articles"}
          onClick={() =>
            onConfirmAndRun("nuke_articles", "TÜM haberler ve kümeler silinecek!")
          }
        />
      </CardContent>
    </Card>
  );
}
