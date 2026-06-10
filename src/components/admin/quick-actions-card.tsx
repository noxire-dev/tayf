import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ActionRow } from "./action-row";
import { Trash2, AlertTriangle } from "lucide-react";

export function QuickActionsCard({
  actionLoading,
  onConfirmAndRun,
}: {
  missingImages?: number;
  actionLoading: string | null;
  onRun?: (action: string) => void;
  onConfirmAndRun: (action: string, label: string) => void;
}) {
  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-serif">Hızlı İşlemler</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
