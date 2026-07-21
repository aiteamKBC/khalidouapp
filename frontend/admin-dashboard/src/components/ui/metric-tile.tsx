import type { LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const tones = {
  pink: "bg-[#fce3ec] text-[#e5185d] dark:bg-[#38142b] dark:text-[#f0538b]",
  green: "bg-[#e6f6ec] text-[#16a34a] dark:bg-[#123122] dark:text-[#37d17f]",
  amber: "bg-[#fbf1dd] text-[#c47d0e] dark:bg-[#2c2413] dark:text-[#e0a648]",
  blue: "bg-[#e8eefc] text-[#3b6fe0] dark:bg-[#182543] dark:text-[#6f9bf0]",
  violet: "bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300",
  danger: "bg-[#fbe9e9] text-[#dc2626] dark:bg-[#331a1d] dark:text-[#f2626e]",
  muted: "bg-[#efe9f1] text-[#5d5578] dark:bg-[#271d3a] dark:text-[#a79dbb]",
};

export function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "pink",
  to,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  tone?: keyof typeof tones;
  /** Renders the tile as a router Link instead of a static div. */
  to?: string;
  /** Renders the tile as a button instead of a static div. */
  onClick?: () => void;
}) {
  const className =
    "studio-card group flex min-h-[120px] min-w-0 flex-col items-center justify-center gap-3 rounded-2xl border bg-card p-4 text-center transition hover:-translate-y-0.5 hover:border-primary/15 hover:shadow-md";

  const content = (
    <>
      <span
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-transform group-hover:scale-105",
          tones[tone],
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="font-mono-numeric truncate text-3xl font-extrabold leading-none">{value}</p>
        <p className="mt-2 truncate text-xs font-extrabold uppercase tracking-wide text-muted-foreground">{label}</p>
        {hint && (
          <p className="mt-1 truncate text-[10.5px] font-semibold text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}
