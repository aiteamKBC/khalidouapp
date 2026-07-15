import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
      <div className="relative min-w-0 pl-4 before:absolute before:inset-y-1 before:left-0 before:w-1 before:rounded-full before:bg-gradient-to-b before:from-[#e5185d] before:to-violet-500">
        <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#e5185d] dark:text-[#f0538b]">
          Khaliduo workspace
        </p>
        <h1 className="truncate text-2xl font-extrabold tracking-[-0.035em] text-foreground sm:text-[26px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-[13px] font-medium text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
