import { useQuery } from "@tanstack/react-query";
import { AppWindow, Clock3, Globe2, History } from "lucide-react";
import { getApplicationHistory } from "@/api/sessions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ApplicationHistoryPanel({
  employeeId,
  day,
  onDayChange,
  showDayPicker = true,
  enabled = true,
}: {
  employeeId: string;
  day: string;
  onDayChange: (day: string) => void;
  showDayPicker?: boolean;
  enabled?: boolean;
}) {
  const history = useQuery({
    queryKey: ["application-history", employeeId, day],
    queryFn: () => getApplicationHistory(employeeId, day),
    enabled: enabled && Boolean(employeeId && day),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const data = history.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-4 p-4">
          <div>
            <p className="font-semibold">Application & website history</p>
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
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          {data && (
            <p className="text-sm text-muted-foreground">
              {data.date} · Times shown in {data.timezone}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {history.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          )}
          {history.isError && (
            <EmptyState
              icon={History}
              title="History couldn't be loaded"
              description="Check the connection and try this day again."
            />
          )}
          {!history.isLoading && !history.isError && data?.items.length === 0 && (
            <EmptyState
              icon={History}
              title="No application history for this day"
              description="New activity appears after the updated Windows desktop agent starts tracking work."
            />
          )}
          {data && data.items.length > 0 && (
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
                        <p className="truncate text-xs text-muted-foreground">{item.processName}</p>
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
                    {formatHistoryTime(item.startedAt, data.timezone)}
                  </time>
                  <span className="text-sm font-semibold">
                    {formatDuration(item.durationSeconds)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
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

function formatHistoryTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone || undefined,
  }).format(new Date(value));
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
