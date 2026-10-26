import type { ComponentProps } from "react";
import type { PageHeader as SharedPageHeader } from "@/components/ui/page-header";

export function PageHeader({
  title,
  description,
  actions,
}: ComponentProps<typeof SharedPageHeader>) {
  return (
    <header className="admin-page-header">
      <div className="admin-page-heading">
        <p>Khaliduo workspace</p>
        <h1>{title}</h1>
        {description && <div className="admin-page-description">{description}</div>}
      </div>
      {actions && <div className="admin-page-actions">{actions}</div>}
    </header>
  );
}
