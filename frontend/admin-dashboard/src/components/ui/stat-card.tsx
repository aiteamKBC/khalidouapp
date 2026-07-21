import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive" | "info";
}) {
  const toneClass = {
    default: "text-primary bg-primary/10",
    success: "text-success bg-success/10",
    warning: "text-warning-foreground bg-warning/20",
    destructive: "text-destructive bg-destructive/10",
    info: "text-info bg-info/10",
  }[tone];

  return (
    <Card className="group overflow-hidden transition hover:-translate-y-0.5 hover:border-primary/15 hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex min-h-[108px] flex-col items-center justify-center gap-3 text-center">
          {Icon && (
            <div
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-transform group-hover:scale-105 ${toneClass}`}
            >
              <Icon className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-mono-numeric text-3xl font-extrabold leading-none text-foreground">
              {value}
            </p>
            <p className="mt-2 text-xs font-extrabold uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
