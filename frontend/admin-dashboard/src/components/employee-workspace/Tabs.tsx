import { WorkspaceIcon } from "./WorkspaceIcon";
export type TabKey = "overview" | "tasks" | "attendance" | "requests" | "screenshots";

type Props = {
  value: TabKey;
  onChange: (value: TabKey) => void;
  counts: Partial<Record<TabKey, number>>;
};

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "ri-layout-grid-line" },
  { key: "tasks", label: "My tasks", icon: "ri-task-line" },
  { key: "attendance", label: "Attendance", icon: "ri-time-line" },
  { key: "screenshots", label: "Screenshots", icon: "ri-image-line" },
  { key: "requests", label: "Requests", icon: "ri-inbox-archive-line" },
];

export default function Tabs({ value, onChange, counts }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Dashboard sections"
      className="sticky top-[70px] z-30 -mx-4 flex flex-wrap items-center gap-1 border-b border-ew-line bg-ew-bg px-4 py-2 md:static md:mx-0 md:rounded-md md:border md:border-ew-line md:bg-ew-card md:px-1.5 md:py-1.5"
    >
      {TABS.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`tab-${tab.key}`}
            aria-selected={active}
            aria-controls={`panel-${tab.key}`}
            onClick={() => onChange(tab.key)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors whitespace-nowrap ${
              active ? "bg-ew-solid text-white" : "text-ew-ink-2 hover:bg-ew-bg-2"
            }`}
          >
            <span className="flex h-4 w-4 items-center justify-center">
              <WorkspaceIcon className={`${tab.icon} text-[14px]`} aria-hidden="true" />
            </span>
            {tab.label}
            {counts[tab.key] ? (
              <span
                className={`ml-0.5 rounded px-1 font-ew-mono text-[10px] font-medium ${
                  active ? "bg-white/20 text-white" : "bg-ew-bg-2 text-ew-muted"
                }`}
              >
                {counts[tab.key]}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
