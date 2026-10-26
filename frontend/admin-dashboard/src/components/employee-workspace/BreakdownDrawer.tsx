import Drawer from "@/components/employee-workspace/Drawer";
import {
  countedSeconds,
  type SummaryKey,
  type TimeSummary,
} from "@/components/employee-workspace/model";
import { fmtNumber, fmtSeconds } from "@/components/employee-workspace/format";

type Props = {
  open: boolean;
  summary: TimeSummary | null;
  onClose: () => void;
  onSelectScope: (key: SummaryKey) => void;
  scopes: TimeSummary[];
};

type Row = {
  label: string;
  hint: string;
  counted: boolean;
  seconds: number;
};

export default function BreakdownDrawer({ open, summary, onClose, onSelectScope, scopes }: Props) {
  if (!summary) return null;
  const b = summary.breakdown;
  const counted = countedSeconds(b);

  const rows: Row[] = [
    {
      label: "Worked",
      hint: "Tracked sessions with activity",
      counted: true,
      seconds: b.workedSeconds,
    },
    { label: "Idle", hint: "Tracked but no activity", counted: false, seconds: b.idleSeconds },
    {
      label: "Manual approved",
      hint: "Signed off by a manager",
      counted: true,
      seconds: b.manualApprovedSeconds,
    },
    {
      label: "Manual pending",
      hint: "Waiting for a manager",
      counted: false,
      seconds: b.manualPendingSeconds,
    },
    {
      label: "Manual rejected",
      hint: "Declined by a manager",
      counted: false,
      seconds: b.manualRejectedSeconds,
    },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={`Time breakdown · ${summary.range}`}
      title={summary.label}
      description="Only worked time and approved manual time are counted. Pending and rejected minutes never enter the total."
    >
      <div className="flex flex-wrap gap-1.5">
        {scopes.map((scope) => (
          <button
            key={scope.key}
            type="button"
            onClick={() => onSelectScope(scope.key)}
            aria-pressed={scope.key === summary.key}
            className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
              scope.key === summary.key
                ? "border-ew-plum bg-ew-plum text-white"
                : "border-ew-line bg-white text-ew-ink-2 hover:bg-ew-bg-2"
            }`}
          >
            {scope.label}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-xl border border-ew-line bg-ew-bg-2 px-3.5 py-3">
        <p className="k-label">Total counted</p>
        <p className="mt-1 font-ew-heading text-[30px] font-semibold leading-none text-ew-plum">
          {fmtSeconds(counted, true)}
        </p>
        <p className="mt-1 text-[11.5px] text-ew-muted">
          Worked plus approved manual time · {summary.range}
        </p>
      </div>

      <ul className="k-divide mt-3 overflow-hidden rounded-xl border border-ew-line">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3 bg-ew-card px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-ew-ink">{row.label}</p>
              <p className="mt-0.5 truncate text-[11px] text-ew-muted">{row.hint}</p>
            </div>
            <span
              className={`flex-none rounded px-1.5 py-[2px] text-[9.5px] font-semibold tracking-wide ${
                row.counted ? "bg-ew-ok-2 text-ew-ok" : "bg-ew-bg-2 text-ew-muted"
              }`}
            >
              {row.counted ? "COUNTED" : "NOT COUNTED"}
            </span>
            <p className="w-[70px] flex-none text-right font-ew-mono text-[12.5px] font-medium text-ew-ink">
              {fmtSeconds(row.seconds)}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-ew-line px-3 py-2">
          <p className="k-label">Manual time total</p>
          <p className="mt-1 font-ew-mono text-[15px] font-semibold text-ew-plum">
            {b.manualTotalSeconds === null ? "—" : fmtSeconds(b.manualTotalSeconds)}
          </p>
        </div>
        <div className="rounded-lg border border-ew-line px-3 py-2">
          <p className="k-label">Tracked sessions</p>
          <p className="mt-1 font-ew-mono text-[15px] font-semibold text-ew-plum">
            {b.sessions ?? "—"}
          </p>
        </div>
        <div className="rounded-lg border border-ew-line px-3 py-2">
          <p className="k-label">Points</p>
          <p className="mt-1 font-ew-mono text-[15px] font-semibold text-ew-plum">
            {b.points === null ? "—" : fmtNumber(b.points)}
          </p>
        </div>
        <div className="rounded-lg border border-ew-line px-3 py-2">
          <p className="k-label">Screenshots</p>
          <p className="mt-1 font-ew-mono text-[15px] font-semibold text-ew-plum">
            {b.screenshots === null ? "—" : fmtNumber(b.screenshots)}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-1 rounded-lg border border-ew-line bg-ew-bg-2 px-3 py-2.5">
        <p className="font-ew-mono text-[10px] uppercase tracking-[0.08em] text-ew-muted">
          Metadata
        </p>
        <p className="text-[11.5px] text-ew-ink-2">{b.sources}</p>
        <p className="text-[11.5px] text-ew-ink-2">Last updated {b.updatedAt}</p>
        <p className="pt-1 text-[11px] leading-snug text-ew-muted">
          Zero means nothing was recorded in this category. A dash means the figure was not
          available for this period.
        </p>
      </div>
    </Drawer>
  );
}
