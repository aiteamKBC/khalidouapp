import { WorkspaceIcon } from "./WorkspaceIcon";
import AnimatedNumber from "@/components/motion/AnimatedNumber";
import {
  countedSeconds,
  type SummaryKey,
  type TimeSummary,
} from "@/components/employee-workspace/model";
import { fmtNumber, fmtSeconds } from "@/components/employee-workspace/format";

type Props = {
  summaries: TimeSummary[];
  onBreakdown: (key: SummaryKey) => void;
};

export default function TimeSummaryCards({ summaries, onBreakdown }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {summaries.map((summary) => {
        const counted = countedSeconds(summary.breakdown);
        const progress = Math.min(
          100,
          summary.breakdown.targetSeconds > 0
            ? Math.round((counted / summary.breakdown.targetSeconds) * 100)
            : 0,
        );
        return (
          <article key={summary.key} className="k-card flex flex-col p-3.5" data-motion-reveal="">
            <div className="flex items-baseline justify-between gap-2">
              <p className="k-label">{summary.label}</p>
              <p className="font-ew-mono text-[10px] text-ew-faint">{summary.range}</p>
            </div>

            <div className="mt-1.5 flex items-end gap-1.5">
              <p className="font-ew-heading text-[27px] font-semibold leading-none text-ew-plum">
                <AnimatedNumber value={counted} format={(seconds) => fmtSeconds(seconds, true)} />
              </p>
              <span className="pb-0.5 text-[11.5px] font-medium text-ew-muted">counted</span>
            </div>

            <div className="mt-2.5">
              <div className="k-bar" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1 font-ew-mono text-[9.5px] uppercase tracking-[0.08em] text-ew-faint">
                {summary.breakdown.targetSeconds > 0
                  ? `${progress}% of ${summary.breakdown.targetSeconds / 3600}h target`
                  : "No scheduled target"}
              </p>
            </div>

            <div className="mt-auto flex items-center gap-3 pt-2.5 text-[11px] text-ew-muted">
              <span className="inline-flex items-center gap-1">
                <span className="flex h-3 w-3 items-center justify-center">
                  <WorkspaceIcon className="ri-award-line text-[11px]" aria-hidden="true" />
                </span>
                <span className="font-ew-mono text-[11px] font-medium text-ew-ink-2">
                  {summary.breakdown.points === null ? (
                    fmtNumber(null)
                  ) : (
                    <AnimatedNumber value={summary.breakdown.points} format={fmtNumber} />
                  )}
                </span>
                pts
              </span>
              <span className="h-3 w-px bg-ew-line" aria-hidden="true" />
              <span className="inline-flex items-center gap-1">
                <span className="flex h-3 w-3 items-center justify-center">
                  <WorkspaceIcon className="ri-image-line text-[11px]" aria-hidden="true" />
                </span>
                <span className="font-ew-mono text-[11px] font-medium text-ew-ink-2">
                  {summary.breakdown.screenshots === null ? (
                    fmtNumber(null)
                  ) : (
                    <AnimatedNumber value={summary.breakdown.screenshots} format={fmtNumber} />
                  )}
                </span>
                shots
              </span>
            </div>

            <button
              type="button"
              onClick={() => onBreakdown(summary.key)}
              className="mt-2.5 flex w-full cursor-pointer items-center justify-between rounded-lg border border-ew-line bg-ew-bg-2 px-2.5 py-1.5 text-[12px] font-semibold text-ew-plum transition-colors hover:border-ew-plum-2"
            >
              Breakdown
              <span className="flex h-4 w-4 items-center justify-center">
                <WorkspaceIcon className="ri-arrow-right-line text-[13px]" aria-hidden="true" />
              </span>
            </button>
          </article>
        );
      })}
    </div>
  );
}
