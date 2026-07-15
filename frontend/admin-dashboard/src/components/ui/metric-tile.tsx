import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const tones = {
  pink: "bg-[#fce3ec] text-[#e5185d] dark:bg-[#38142b] dark:text-[#f0538b]",
  green: "bg-[#e6f6ec] text-[#16a34a] dark:bg-[#123122] dark:text-[#37d17f]",
  amber: "bg-[#fbf1dd] text-[#c47d0e] dark:bg-[#2c2413] dark:text-[#e0a648]",
  blue: "bg-[#e8eefc] text-[#3b6fe0] dark:bg-[#182543] dark:text-[#6f9bf0]",
  violet: "bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300",
};

export function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "pink",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  tone?: keyof typeof tones;
}) {
  return (
    <div className="studio-card group flex min-w-0 items-center gap-3 rounded-2xl border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary/15 hover:shadow-md">
      <span
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-transform group-hover:scale-105",
          tones[tone],
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="font-mono-numeric truncate text-2xl font-extrabold leading-none">{value}</p>
        <p className="mt-1.5 truncate text-xs font-bold">{label}</p>
        {hint && (
          <p className="mt-0.5 truncate text-[10.5px] font-semibold text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
