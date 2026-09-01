import { Link } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Camera, ChevronLeft, ChevronRight, Download, ImageOff, Images } from "lucide-react";
import { toast } from "sonner";

import { retryTransientRequest } from "@/api/client";
import { downloadScreenshot, listScreenshotPage } from "@/api/screenshots";
import { ProtectedImage } from "@/components/ProtectedImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/format";
import {
  monitoringDetailEnabled,
  monitoringDetailPolicy,
  monitoringDetailQueryKey,
} from "@/lib/monitoring-query-policy";
import type { Screenshot } from "@/types";

export default function MonitoringScreenshotsTab({
  employeeId,
  employeeName,
  day,
  scope,
  queryScopeKey,
  enabled,
}: {
  employeeId: string;
  employeeName: string;
  day: string;
  scope?: string[];
  queryScopeKey: string;
  enabled: boolean;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Screenshot | null>(null);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const policy = monitoringDetailPolicy(day);
  const screenshots = useQuery({
    queryKey: monitoringDetailQueryKey("screenshots", queryScopeKey, employeeId, day, page),
    queryFn: ({ signal }) =>
      listScreenshotPage(
        {
          scopedTeamIds: scope,
          page,
          pageSize: 24,
          employeeId,
          day,
        },
        signal,
      ),
    enabled: monitoringDetailEnabled(enabled, employeeId, day),
    staleTime: policy.staleTime,
    gcTime: 30 * 60_000,
    refetchInterval: enabled ? policy.refetchInterval : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    retry: retryTransientRequest,
  });

  useEffect(() => {
    setPage(1);
    setSelected(null);
    setFailedIds(new Set());
  }, [day, employeeId]);

  const items = screenshots.data?.items ?? [];
  const selectedIndex = selected ? items.findIndex((item) => item.id === selected.id) : -1;
  const initialLoading = screenshots.isPending && !screenshots.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold">{employeeName}'s screenshots</p>
              {screenshots.isFetching && screenshots.data && (
                <span className="text-xs font-semibold text-muted-foreground">Refreshing...</span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {screenshots.data?.total ?? 0} captures recorded on {day}.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/screenshots" search={{ employeeId, day }}>
              <Images className="mr-2 h-4 w-4" />
              Open screenshot library
            </Link>
          </Button>
        </CardContent>
      </Card>

      {initialLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="aspect-video animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : screenshots.isError && !screenshots.data ? (
        <EmptyState
          icon={ImageOff}
          title="Screenshots couldn't be loaded"
          description="Check the connection and try this employee and workday again."
          action={<Button onClick={() => screenshots.refetch()}>Retry</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Camera}
          title="No screenshots for this day"
          description="No captured screens were found for the selected employee and workday."
        />
      ) : (
        <>
          {screenshots.isError && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
              <span>The last refresh failed. The previous screenshots are still shown.</span>
              <Button variant="outline" size="sm" onClick={() => screenshots.refetch()}>
                Retry
              </Button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((shot) => (
              <button
                key={shot.id}
                type="button"
                onClick={() => setSelected(shot)}
                className="group overflow-hidden rounded-2xl border bg-card p-2 text-left transition duration-200 hover:-translate-y-1 hover:border-primary/25 hover:shadow-lg"
              >
                <span className="block aspect-video overflow-hidden rounded-xl bg-muted ring-1 ring-border">
                  {failedIds.has(shot.id) ? (
                    <span className="grid h-full place-items-center text-muted-foreground">
                      <ImageOff className="h-6 w-6" />
                    </span>
                  ) : (
                    <ProtectedImage
                      src={shot.thumbnailUrl}
                      alt={`Screenshot captured ${formatDateTime(shot.capturedAt)}`}
                      width={640}
                      height={360}
                      onLoadError={() => setFailedIds((previous) => new Set(previous).add(shot.id))}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                    />
                  )}
                </span>
                <span className="flex items-center justify-between gap-2 px-1 pb-1 pt-3 text-xs">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {shot.displayName || "Captured screen"}
                    </span>
                    <span className="block truncate text-muted-foreground">
                      {formatDateTime(shot.capturedAt)}
                    </span>
                  </span>
                  <span className="shrink-0 capitalize text-muted-foreground">
                    {shot.workCategory.replaceAll("_", " ")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {screenshots.data && screenshots.data.pages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {screenshots.data.page} of {screenshots.data.pages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || screenshots.isFetching}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= screenshots.data.pages || screenshots.isFetching}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-5xl">
          <DialogTitle className="sr-only">Screenshot preview</DialogTitle>
          {selected && (
            <div>
              <ProtectedImage
                src={selected.fullUrl}
                alt={`Screenshot captured ${formatDateTime(selected.capturedAt)}`}
                eager
                width={1920}
                height={1080}
                className="max-h-[72vh] w-full rounded-xl object-contain ring-1 ring-border"
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{employeeName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(selected.capturedAt)}
                    {selected.displayName ? ` · ${selected.displayName}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedIndex <= 0}
                    onClick={() => setSelected(items[selectedIndex - 1])}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedIndex < 0 || selectedIndex >= items.length - 1}
                    onClick={() => setSelected(items[selectedIndex + 1])}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadScreenshot(selected).catch((error) =>
                        toast.error(error instanceof Error ? error.message : "Download failed"),
                      )
                    }
                  >
                    <Download className="mr-1 h-4 w-4" />
                    Download
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
