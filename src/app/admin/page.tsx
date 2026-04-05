"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Newspaper,
  Building2,
  Layers,
  ImageOff,
  RefreshCw,
  Trash2,
  Image,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Plus,
  Pencil,
  ExternalLink,
} from "lucide-react";

interface SourceItem {
  id: string;
  name: string;
  slug: string;
  url: string;
  rss_url: string;
  bias: string;
  active: boolean;
}

interface Stats {
  articles: number;
  sources: number;
  clusters: number;
  missingImages: number;
  sourcesList: SourceItem[];
}

type ActionResult = {
  success?: boolean;
  error?: string;
  message?: string;
  [key: string]: unknown;
};

const EMPTY_SOURCE: SourceItem = {
  id: "",
  name: "",
  slug: "",
  url: "",
  rss_url: "",
  bias: "independent",
  active: true,
};

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);

  // Source dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"add" | "edit">("add");
  const [editSource, setEditSource] = useState<SourceItem>(EMPTY_SOURCE);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin");
      const data = await res.json();
      setStats(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  async function runAction(
    action: string,
    extraBody?: Record<string, unknown>
  ) {
    setActionLoading(action);
    setLastResult(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extraBody }),
      });
      const data = await res.json();
      setLastResult(data);
      await fetchStats();
    } catch (e) {
      setLastResult({ error: (e as Error).message });
    } finally {
      setActionLoading(null);
    }
  }

  function confirmAndRun(action: string, label: string) {
    if (window.confirm(`${label}\n\nBu işlem geri alınamaz. Emin misiniz?`)) {
      runAction(action);
    }
  }

  function openAddDialog() {
    setEditSource(EMPTY_SOURCE);
    setDialogMode("add");
    setDialogOpen(true);
  }

  function openEditDialog(source: SourceItem) {
    setEditSource({ ...source });
    setDialogMode("edit");
    setDialogOpen(true);
  }

  async function handleSaveSource() {
    const action = dialogMode === "add" ? "add_source" : "update_source";
    setActionLoading("save_source");
    setLastResult(null);

    // Auto-generate slug from name if empty
    const slug =
      editSource.slug ||
      editSource.name
        .toLowerCase()
        .replace(/[şŞ]/g, "s")
        .replace(/[çÇ]/g, "c")
        .replace(/[ğĞ]/g, "g")
        .replace(/[üÜ]/g, "u")
        .replace(/[öÖ]/g, "o")
        .replace(/[ıİ]/g, "i")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...editSource,
          slug,
        }),
      });
      const data = await res.json();
      setLastResult(data);
      if (data.success) {
        setDialogOpen(false);
        await fetchStats();
      }
    } catch (e) {
      setLastResult({ error: (e as Error).message });
    } finally {
      setActionLoading(null);
    }
  }

  function handleDeleteSource(source: SourceItem) {
    if (
      window.confirm(
        `"${source.name}" kaynağı ve tüm haberleri silinecek.\n\nEmin misiniz?`
      )
    ) {
      runAction("delete_source", { id: source.id });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Admin Panel</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Dev tools for testing and managing Tayf
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchStats}
          className="text-xs"
        >
          <RefreshCw className="h-3 w-3 mr-1.5" />
          Yenile
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Newspaper} label="Haberler" value={stats?.articles ?? 0} />
        <StatCard icon={Building2} label="Kaynaklar" value={stats?.sources ?? 0} />
        <StatCard icon={Layers} label="Kümeler" value={stats?.clusters ?? 0} />
        <StatCard
          icon={ImageOff}
          label="Görselsiz"
          value={stats?.missingImages ?? 0}
          variant={stats?.missingImages ? "warning" : "default"}
        />
      </div>

      {/* Action Result */}
      {lastResult && (
        <div
          className={`mb-4 rounded-lg border p-3 text-sm ${
            lastResult.error
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-green-500/30 bg-green-500/10 text-green-400"
          }`}
        >
          <div className="flex items-start gap-2">
            {lastResult.error ? (
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
            )}
            <pre className="text-xs whitespace-pre-wrap font-mono">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Quick Actions */}
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
            onClick={() => runAction("ingest")}
          />
          <Separator />
          <ActionRow
            icon={Image}
            title="Görselleri Tamamla"
            description={`Görseli olmayan ${stats?.missingImages ?? 0} haber için og:image çeker`}
            buttonLabel="Tamamla"
            buttonVariant="default"
            loading={actionLoading === "backfill_images"}
            onClick={() => runAction("backfill_images")}
          />
          <Separator />
          <ActionRow
            icon={Trash2}
            title="Kümeleri Sil"
            description="Tüm haber kümelerini siler, haberler korunur"
            buttonLabel="Kümeleri Sil"
            buttonVariant="destructive"
            loading={actionLoading === "nuke_clusters"}
            onClick={() => confirmAndRun("nuke_clusters", "Tüm kümeler silinecek.")}
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
              confirmAndRun("nuke_articles", "TÜM haberler ve kümeler silinecek!")
            }
          />
        </CardContent>
      </Card>

      {/* Sources Management */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Kaynaklar</CardTitle>
            <Button size="sm" className="text-xs h-7" onClick={openAddDialog}>
              <Plus className="h-3 w-3 mr-1" />
              Kaynak Ekle
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {stats?.sourcesList.map((source) => (
              <div
                key={source.id}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors ${
                  source.active ? "hover:bg-muted/50" : "opacity-50 bg-muted/20"
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{source.name}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${biasColor(source.bias)}`}
                      >
                        {biasLabel(source.bias)}
                      </Badge>
                      {!source.active && (
                        <Badge variant="secondary" className="text-[10px]">
                          Devre Dışı
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                        {source.rss_url}
                      </span>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground/50 hover:text-muted-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => openEditDialog(source)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant={source.active ? "outline" : "secondary"}
                    size="sm"
                    className="text-[11px] h-7 px-2"
                    disabled={actionLoading === `toggle_${source.slug}`}
                    onClick={() =>
                      runAction("toggle_source", {
                        slug: source.slug,
                        active: !source.active,
                      })
                    }
                  >
                    {source.active ? "Devre Dışı Bırak" : "Aktifleştir"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive/60 hover:text-destructive"
                    onClick={() => handleDeleteSource(source)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Source Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {dialogMode === "add" ? "Yeni Kaynak Ekle" : "Kaynağı Düzenle"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Kaynak Adı</Label>
              <Input
                placeholder="Örn: Hürriyet"
                value={editSource.name}
                onChange={(e) =>
                  setEditSource({ ...editSource, name: e.target.value })
                }
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Slug (otomatik oluşturulur)</Label>
              <Input
                placeholder="Örn: hurriyet"
                value={editSource.slug}
                onChange={(e) =>
                  setEditSource({ ...editSource, slug: e.target.value })
                }
                className="h-8 text-sm font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Web Sitesi URL</Label>
              <Input
                placeholder="https://www.hurriyet.com.tr"
                value={editSource.url}
                onChange={(e) =>
                  setEditSource({ ...editSource, url: e.target.value })
                }
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">RSS Feed URL</Label>
              <Input
                placeholder="https://www.hurriyet.com.tr/rss/anasayfa"
                value={editSource.rss_url}
                onChange={(e) =>
                  setEditSource({ ...editSource, rss_url: e.target.value })
                }
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Yanlılık Etiketi</Label>
              <Select
                value={editSource.bias}
                onValueChange={(value) =>
                  value && setEditSource({ ...editSource, bias: value })
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pro_government">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      Hükümete Yakın
                    </span>
                  </SelectItem>
                  <SelectItem value="opposition">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                      Muhalefet
                    </span>
                  </SelectItem>
                  <SelectItem value="independent">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      Bağımsız
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setDialogOpen(false)}
            >
              İptal
            </Button>
            <Button
              size="sm"
              className="text-xs"
              disabled={
                !editSource.name ||
                !editSource.url ||
                !editSource.rss_url ||
                actionLoading === "save_source"
              }
              onClick={handleSaveSource}
            >
              {actionLoading === "save_source" && (
                <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
              )}
              {dialogMode === "add" ? "Ekle" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  variant = "default",
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  variant?: "default" | "warning";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div
            className={`rounded-md p-2 ${
              variant === "warning"
                ? "bg-amber-500/15 text-amber-500"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionRow({
  icon: Icon,
  title,
  description,
  buttonLabel,
  buttonVariant,
  loading,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  buttonLabel: string;
  buttonVariant: "default" | "destructive";
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button
        variant={buttonVariant}
        size="sm"
        className="text-xs shrink-0"
        disabled={loading}
        onClick={onClick}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
        {buttonLabel}
      </Button>
    </div>
  );
}

function biasColor(bias: string) {
  switch (bias) {
    case "pro_government":
      return "bg-red-500/15 text-red-400 border-red-500/20";
    case "opposition":
      return "bg-blue-500/15 text-blue-400 border-blue-500/20";
    case "independent":
      return "bg-green-500/15 text-green-400 border-green-500/20";
    default:
      return "";
  }
}

function biasLabel(bias: string) {
  switch (bias) {
    case "pro_government":
      return "Hükümete Yakın";
    case "opposition":
      return "Muhalefet";
    case "independent":
      return "Bağımsız";
    default:
      return bias;
  }
}
