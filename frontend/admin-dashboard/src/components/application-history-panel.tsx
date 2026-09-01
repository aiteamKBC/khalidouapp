import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppWindow, ChevronLeft, ChevronRight, Clock3, Globe2, History } from "lucide-react";

import { retryTransientRequest } from "@/api/client";
import { getApplicationHistory } from "@/api/sessions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatClock } from "@/lib/format";
import {
  monitoringDetailEnabled,
  monitoringDetailPolicy,
  monitoringDetailQueryKey,
} from "@/lib/monitoring-query-policy";

export function ApplicationHistoryPanel({
  employeeId,
  day,
  onDayChange,
  showDayPicker = true,
  enabled = true,
  queryScopeKey = "standalone",
}: {
  employeeId: string;
  day: string;
  onDayChange: (day: string) => void;
  showDayPicker?: boolean;
  enabled?: boolean;
  queryScopeKey?: string;
}) {
  const [page, setPage] = useState(1);
  const policy = monitoringDetailPolicy(day);

  useEffect(() => {
    setPage(1);
  }, [day, employeeId]);

  const history = useQuery({
    queryKey: monitoringDetailQueryKey("applications", queryScopeKey, employeeId, day, page),
    queryFn: ({ signal }) => getApplicationHistory(employeeId, day, page, signal),
    enabled: monitoringDetailEnabled(enabled, employeeId, day),
    staleTime: policy.staleTime,
    gcTime: 30 * 60_000,
    refetchInterval: enabled ? policy.refetchInterval : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    retry: retryTransientRequest,
  });

  const data = history.data;
  const initialLoading = history.isPending && !data;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-4 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">Application & website history</p>
              {history.isFetching && data && (
                <span className="text-xs font-semibold text-muted-foreground">Refreshing...</span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Records application names and website domains only. Full URLs, page titles, and typed
              content are not collected.
            </p>
          </div>
          {showDayPicker && (
            <div className="w-full space-y-1 sm:w-48">
              <Label htmlFor={`application-history-day-${employeeId}`}>Day</Label>
              <Input
                id={`application-history-day-${employeeId}`}
                type="date"
                value={day}
                onChange={(event) => onDayChange(event.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {initialLoading && <ApplicationHistorySkeleton />}

      {history.isError && !data && (
        <EmptyState
          icon={History}
          title="History couldn't be loaded"
          description="Check the connection and try this day again."
          action={<Button onClick={() => history.refetch()}>Retry</Button>}
        />
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <HistoryMetric
              icon={Clock3}
              label="Recorded usage"
              value={formatDuration(data.totalSeconds)}
            />
            <HistoryMetric
              icon={AppWindow}
              label="Applications"
              value={String(data.applicationCount)}
            />
            <HistoryMetric icon={Globe2} label="Websites" value={String(data.websiteCount)} />
          </div>

          {(data.applications.length > 0 || data.websites.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              <UsageTotals
                title="Top applications"
                icon={AppWindow}
                items={data.applications.map((item) => ({
                  label: item.name,
                  seconds: item.durationSeconds,
                }))}
              />
              <UsageTotals
                title="Top websites"
                icon={Globe2}
                items={data.websites.map((item) => ({
                  label: item.domain,
                  seconds: item.durationSeconds,
                }))}
              />
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
              <p className="text-sm text-muted-foreground">
                {data.date} · Times shown in {data.timezone}
              </p>
            </CardHeader>
            <CardContent>
              {history.isError && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
                  <span>The last refresh failed. The previous results are still shown.</span>
                  <Button variant="outline" size="sm" onClick={() => history.refetch()}>
                    Retry
                  </Button>
                </div>
              )}
              {data.items.length === 0 ? (
                <EmptyState
                  icon={History}
                  title="No application history for this day"
                  description="No application activity has reached the server for this day. Keep the updated Windows desktop app open while tracking; saved activity syncs automatically after the connection recovers."
                />
              ) : (
                <div className="divide-y">
                  {data.items.map((item) => (
                    <div
                      key={item.id}
                      className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                          <AppWindow className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{item.applicationName}</p>
                          {item.processName && (
                            <p className="truncate text-xs text-muted-foreground">
                              {item.processName}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="min-w-0">
                        {item.siteDomain ? (
                          <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-blue-50 px-2.5 py-1 text-sm font-medium text-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
                            <Globe2 className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{item.siteDomain}</span>
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Application usage</span>
                        )}
                      </div>
                      <time className="text-sm text-muted-foreground">
                        {formatClock(item.startedAt, data.timezone)}
                      </time>
                      <span className="text-sm font-semibold">
                        {formatDuration(item.durationSeconds)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {data.pages > 1 && (
                <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {data.page} of {data.pages} · {data.total} entries
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || history.isFetching}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= data.pages || history.isFetching}
                      onClick={() => setPage((current) => current + 1)}
                    >
                      Next
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ApplicationHistorySkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

function HistoryMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
        </div>
        <Icon className="h-6 w-6 text-primary" />
      </CardContent>
    </Card>
  );
}

function UsageTotals({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: typeof AppWindow;
  items: Array<{ label: string; seconds: number }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.slice(0, 6).map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{item.label}</span>
            <span className="shrink-0 font-semibold">{formatDuration(item.seconds)}</span>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing recorded for this day.</p>
        )}
      </CardContent>
    </Card>
  );
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.round(value || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}
