import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function ActionRow({
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
        className="text-xs shrink-0 hover:border-brand/40"
        disabled={loading}
        onClick={onClick}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
        {buttonLabel}
      </Button>
    </div>
  );
}
