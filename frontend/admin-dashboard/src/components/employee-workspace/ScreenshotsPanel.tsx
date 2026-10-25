import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  employeeScreenshots,
  deleteEmployeeScreenshot,
  type PortalScreenshot,
} from "@/api/employee-portal";
import { retryTransientRequest } from "@/api/client";
import { SCREENSHOT_REFRESH_INTERVAL_MS } from "@/lib/screenshot-display";
import { jwtSubjectScopeKey } from "@/lib/private-query-scope";
import { formatDateTime } from "@/lib/format";
import { ProtectedImage } from "@/components/ProtectedImage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { todayISO } from "./format";

export default function ScreenshotsPanel({ token }: { token: string }) {
  const client = useQueryClient();
  const [day, setDay] = useState(todayISO);
  const [preview, setPreview] = useState<PortalScreenshot | null>(null);
  const [toDelete, setToDelete] = useState<PortalScreenshot | null>(null);
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
  const remove = useMutation({
    mutationFn: (shot: PortalScreenshot) => deleteEmployeeScreenshot(token, shot.id),
    onSuccess: async (result, shot) => {
      setToDelete(null);
      if (preview?.id === shot.id) setPreview(null);
      toast.success(
        `Screenshot deleted. ${Math.round(result.deducted_seconds / 60)} minutes removed from tracked time.`,
      );
      await client.invalidateQueries({ queryKey: scope });
    },
    onError: (error) => {
      setToDelete(null);
      toast.error(error.message);
    },
  });
  return (
    <section className="k-card p-3.5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-ew-heading text-sm font-semibold text-ew-plum">My screenshots</h2>
          <p className="mt-1 text-xs text-ew-muted">
            Review your captured work. Deleting a screenshot also deducts its tracked time.
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
            <figcaption className="flex items-center justify-between gap-2 p-2 text-xs text-ew-muted">
              <span>{formatDateTime(shot.captured_at)}</span>
              <button
                type="button"
                className="rounded p-2 text-ew-bad hover:bg-ew-bad-2"
                onClick={() => setToDelete(shot)}
                aria-label={`Delete screenshot from ${formatDateTime(shot.captured_at)}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
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
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(preview.captured_at)}
                </p>
                <Button
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setToDelete(preview)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete screenshot
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && !remove.isPending && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this screenshot?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting this screenshot also removes{" "}
              {toDelete ? `about ${Math.round(toDelete.tracked_seconds / 60)} minutes of` : "its"}{" "}
              tracked time. Those minutes will not be paid. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (toDelete) remove.mutate(toDelete);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete screenshot and time"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
