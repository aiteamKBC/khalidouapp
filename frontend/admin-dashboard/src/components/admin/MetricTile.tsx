import type { ComponentProps } from "react";
import { Link } from "@tanstack/react-router";
import type { MetricTile as SharedMetricTile } from "@/components/ui/metric-tile";

export function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "pink",
  to,
  onClick,
}: ComponentProps<typeof SharedMetricTile>) {
  const content = (
    <>
      <span className="admin-metric-heading">
        <span>{label}</span>
        <span className="admin-metric-icon" data-tone={tone}>
          <Icon aria-hidden="true" />
        </span>
      </span>
      <span className="admin-metric-value">{value}</span>
      {hint && <span className="admin-metric-hint">{hint}</span>}
    </>
  );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className="admin-metric">
        {content}
      </button>
    );
  if (to)
    return (
      <Link to={to} className="admin-metric">
        {content}
      </Link>
    );
  return <div className="admin-metric">{content}</div>;
}
