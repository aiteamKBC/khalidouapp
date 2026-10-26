import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  employeeScreenshots,
  type PortalScreenshot,
} from "@/api/employee-portal";
import { retryTransientRequest } from "@/api/client";
import { SCREENSHOT_REFRESH_INTERVAL_MS } from "@/lib/screenshot-display";
import { jwtSubjectScopeKey } from "@/lib/private-query-scope";
import { formatDateTime } from "@/lib/format";
import { ProtectedImage } from "@/components/ProtectedImage";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { todayISO } from "./format";

export default function ScreenshotsPanel({ token }: { token: string }) {
  const [day, setDay] = useState(todayISO);
  const [preview, setPreview] = useState<PortalScreenshot | null>(null);
  const scope = ["employee-portal", jwtSubjectScopeKey(token)];
  const screenshots = useQuery({
    queryKey: [...scope, "screenshots", day],
    queryFn: ({ signal }) => employeeScreenshots(token, day, signal),
    staleTime: day === todayISO() ? SCREENSHOT_REFRESH_INTERVAL_MS : 300_000,
    refetchInterval: day === todayISO() ? SCREENSHOT_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    retry: retryTransientRequest,
  });
  return (
    <section className="k-card p-3.5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-ew-heading text-sm font-semibold text-ew-plum">My screenshots</h2>
          <p className="mt-1 text-xs text-ew-muted">
            Review your captured work for the selected day.
          </p>
        </div>
        <div>
          <label htmlFor="screenshot-day" className="k-field-label">
            Date
          </label>
          <input
            id="screenshot-day"
            type="date"
            className="k-input"
            value={day}
            max={todayISO()}
            onChange={(event) => {
              if (event.target.value) setDay(event.target.value);
            }}
          />
        </div>
      </div>
      {screenshots.isPending ? (
        <p role="status" className="py-8 text-center text-ew-muted">
          Loading screenshots…
        </p>
      ) : null}
      {screenshots.isError ? (
        <div role="alert" className="text-sm text-ew-bad">
          Could not load screenshots.{" "}
          <button className="underline" onClick={() => void screenshots.refetch()}>
            Try again
          </button>
        </div>
      ) : null}
      {screenshots.data?.length === 0 ? (
        <p className="py-8 text-center text-ew-muted">No screenshots for this day.</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(screenshots.data ?? []).map((shot) => (
          <figure key={shot.id} className="overflow-hidden rounded-xl border border-ew-line">
            <button
              type="button"
              className="block w-full cursor-zoom-in"
              onClick={() => setPreview(shot)}
              aria-label={`Preview screenshot from ${formatDateTime(shot.captured_at)}`}
            >
              <ProtectedImage
                src={shot.thumbnailUrl || shot.fullUrl}
                authToken={token}
                alt="Work screenshot"
                className="aspect-video w-full object-cover"
              />
            </button>
            <figcaption className="p-2 text-xs text-ew-muted">
              {formatDateTime(shot.captured_at)}
            </figcaption>
          </figure>
        ))}
      </div>
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-6xl">
          <DialogTitle>Screenshot preview</DialogTitle>
          {preview ? (
            <>
              <ProtectedImage
                src={preview.fullUrl}
                authToken={token}
                eager
                alt="Full work screenshot preview"
                className="max-h-[75vh] w-full rounded-lg object-contain"
              />
              <p className="text-xs text-muted-foreground">
                {formatDateTime(preview.captured_at)}
              </p>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
