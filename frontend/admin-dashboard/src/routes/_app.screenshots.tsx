import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Activity,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  Folder,
  FolderOpen,
  ImageOff,
  ListChecks,
  MonitorCheck,
  MonitorX,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ProtectedImage } from "@/components/ProtectedImage";
import {
  deleteScreenshot,
  downloadScreenshot,
  listScreenshotCaptureEvents,
  listScreenshotFolderPage,
  listScreenshotPage,
} from "@/api/screenshots";
import { listEmployees } from "@/api/employees";
import { listTasks } from "@/api/projects";
import { listTeams } from "@/api/teams";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import type { Screenshot } from "@/types";

export const Route = createFileRoute("/_app/screenshots")({
  component: ScreenshotsPage,
});

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function todayIsoDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dayIsoDate(offset: number): string {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function ScreenshotsPage() {
  const { scopedTeamIds, can } = useAuth();
  const canManageScreenshots = can(permissions.screenshotsManage);
  const scope = scopedTeamIds();
  const queryClient = useQueryClient();
  const emps = useQuery({ queryKey: ["employees", scope], queryFn: () => listEmployees(scope) });
  const teams = useQuery({ queryKey: ["teams", scope], queryFn: () => listTeams(scope) });
  const tasks = useQuery({
    queryKey: ["tasks", scope],
    queryFn: () => listTasks({ scopedTeamIds: scope }),
  });

  const [empId, setEmpId] = useState("all");
  const [teamId, setTeamId] = useState("all");
  const [date, setDate] = useState(todayIsoDate);
  const [workCategory, setWorkCategory] = useState("all");
  const [folderStatus, setFolderStatus] = useState("all");
  const [folderPage, setFolderPage] = useState(1);
  const [screenshotPage, setScreenshotPage] = useState(1);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const folders = useQuery({
    queryKey: [
      "screenshot-folders",
      scope,
      folderPage,
      empId,
      teamId,
      date,
      workCategory,
      folderStatus,
    ],
    queryFn: () =>
      listScreenshotFolderPage({
        scopedTeamIds: scope,
        page: folderPage,
        employeeId: empId,
        teamId,
        day: date,
        workCategory,
        folderStatus,
      }),
  });
  const shots = useQuery({
    queryKey: ["screenshots", scope, screenshotPage, selectedFolderId, teamId, date, workCategory],
    queryFn: () =>
      listScreenshotPage({
        scopedTeamIds: scope,
        page: screenshotPage,
        pageSize: 24,
        employeeId: selectedFolderId ?? undefined,
        teamId,
        day: date,
        workCategory,
      }),
    enabled: selectedFolderId !== null,
  });
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const captureAudit = useQuery({
    queryKey: ["screenshot-capture-audit", empId, date],
    queryFn: () =>
      listScreenshotCaptureEvents({
        employeeId: empId === "all" ? undefined : empId,
        day: date || undefined,
        pageSize: 75,
      }),
    enabled: auditOpen,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteScreenshot,
    onSuccess: async (result) => {
      toast.success(
        result.deductedMinutes > 0
          ? `Screenshot deleted and ${result.deductedMinutes} tracked minutes deducted`
          : "Screenshot deleted",
      );
      setOpenIdx(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["screenshots"] }),
        queryClient.invalidateQueries({ queryKey: ["screenshot-folders"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to delete screenshot"),
  });

  useEffect(() => {
    setFolderPage(1);
    setScreenshotPage(1);
    setSelectedFolderId(null);
    setOpenIdx(null);
  }, [empId, teamId, date, workCategory, folderStatus]);

  const filtered = shots.data?.items ?? [];

  const current = openIdx != null ? filtered[openIdx] : null;
  const empOf = (id: string) =>
    (emps.data ?? []).find((employee) => employee.id === id)?.name ?? "-";
  const teamOf = (id: string) => (teams.data ?? []).find((team) => team.id === id)?.name ?? "-";
  const taskOf = (screenshot: Screenshot) =>
    (tasks.data ?? []).find((task) => task.id === screenshot.taskId);
  const selectedFolder = selectedFolderId
    ? folders.data?.items.find((folder) => folder.employeeId === selectedFolderId)
    : null;
  const visibleShots = filtered;

  return (
    <div className="studio-page">
      <PageHeader
        title="Screenshots"
        description={`Employee screenshot folders for ${date}${folders.data ? ` · ${folders.data.total} employees` : ""}.`}
        actions={
          <Button variant="outline" onClick={() => setAuditOpen(true)}>
            <ListChecks className="mr-2 h-4 w-4" /> Capture audit
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-5">
          <Select value={empId} onValueChange={setEmpId}>
            <SelectTrigger>
              <SelectValue placeholder="Employee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {(emps.data ?? []).map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger>
              <SelectValue placeholder="Team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {(teams.data ?? []).map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={date}
            onChange={(event) => {
              const nextDate = event.target.value || todayIsoDate();
              setDate(nextDate);
              if (nextDate !== todayIsoDate() && folderStatus === "active_now") {
                setFolderStatus("all");
              }
            }}
          />
          <Select value={workCategory} onValueChange={setWorkCategory}>
            <SelectTrigger>
              <SelectValue placeholder="Work category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All day</SelectItem>
              <SelectItem value="scheduled_shift">Scheduled shift</SelectItem>
              <SelectItem value="off_shift">Overtime / off-shift</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => {
              setEmpId("all");
              setTeamId("all");
              setDate(todayIsoDate());
              setWorkCategory("all");
              setFolderStatus("all");
            }}
          >
            Reset
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
          <span className="mr-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Quick date
          </span>
          {[
            { label: "Today", value: dayIsoDate(0) },
            { label: "Yesterday", value: dayIsoDate(-1) },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => {
                setDate(option.value);
                if (option.value !== todayIsoDate() && folderStatus === "active_now") {
                  setFolderStatus("all");
                }
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                date === option.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
          <span className="mr-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Show
          </span>
          {[
            { label: "Everyone", value: "all", icon: null },
            ...(date === todayIsoDate()
              ? [{ label: "Active now", value: "active_now", icon: Activity }]
              : []),
            { label: "Worked", value: "worked", icon: MonitorCheck },
            { label: "No work", value: "no_work", icon: MonitorX },
            { label: "Has screenshots", value: "with_screenshots", icon: Camera },
            { label: "Empty folders", value: "empty", icon: FolderOpen },
          ].map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setFolderStatus(option.value)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  folderStatus === option.value
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                {option.label}
              </button>
            );
          })}
        </div>
      </Card>

      {!selectedFolderId ? (
        folders.isLoading ? (
          <div className="grid gap-6 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-80 animate-pulse rounded-2xl border bg-muted" />
            ))}
          </div>
        ) : folders.isError ? (
          <EmptyState
            icon={ImageOff}
            title="Employee folders couldn't be loaded"
            description="Check the API connection and try again."
            action={<Button onClick={() => folders.refetch()}>Retry</Button>}
          />
        ) : folders.data?.items.length ? (
          <div className="grid gap-6 lg:grid-cols-2">
            {folders.data.items.map((folder) => (
              <button
                key={folder.employeeId}
                type="button"
                onClick={() => {
                  setSelectedFolderId(folder.employeeId);
                  setScreenshotPage(1);
                  setOpenIdx(null);
                }}
                className="group relative pt-7 text-left outline-none"
              >
                <span className="absolute left-0 top-0 h-9 w-52 rounded-t-2xl border border-b-0 bg-card transition group-hover:border-primary/30" />
                <span className="absolute left-12 top-3 h-1 w-16 rounded-full bg-primary/80" />
                <span className="relative block overflow-hidden rounded-b-2xl rounded-tr-2xl border bg-card p-4 shadow-sm transition group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-md">
                  <span className="mb-4 flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border bg-primary/5 text-primary">
                        <Folder className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-base font-extrabold text-foreground">
                          {folder.employeeName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {folder.jobTitle || folder.employeeEmail}
                        </span>
                      </span>
                    </span>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        folder.activeNow
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : folder.worked
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${folder.activeNow || folder.worked ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
                      />
                      {folder.activeNow ? "Active now" : folder.worked ? "Worked" : "No work"}
                    </span>
                  </span>

                  {folder.previews.length ? (
                    <span className="grid grid-cols-3 gap-2 rounded-xl border bg-muted/40 p-2">
                      {folder.previews.map((shot) => (
                        <span
                          key={shot.id}
                          className="aspect-video overflow-hidden rounded-lg border bg-card"
                        >
                          <ProtectedImage
                            src={shot.thumbnailUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </span>
                      ))}
                      {Array.from({ length: Math.max(0, 3 - folder.previews.length) }).map(
                        (_, index) => (
                          <span
                            key={`empty-${index}`}
                            className="grid aspect-video place-items-center rounded-lg border border-dashed bg-card/60 text-muted-foreground/40"
                          >
                            <Camera className="h-5 w-5" />
                          </span>
                        ),
                      )}
                    </span>
                  ) : (
                    <span className="grid h-36 place-items-center rounded-xl border border-dashed bg-muted/30 text-center">
                      <span>
                        <FolderOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                        <span className="block text-sm font-semibold text-foreground">
                          {folder.worked ? "No screenshots captured" : "Did not work on this day"}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {folder.worked
                            ? "Work was recorded, but this folder has no images."
                            : `No work session was recorded on ${date}.`}
                        </span>
                      </span>
                    </span>
                  )}

                  <span className="mt-4 flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-extrabold text-primary">
                        {initials(folder.employeeName)}
                      </span>
                      <span className="min-w-0 text-xs text-muted-foreground">
                        <span className="block font-semibold text-foreground">
                          {folder.screenshotCount} screenshot
                          {folder.screenshotCount === 1 ? "" : "s"}
                        </span>
                        <span className="block truncate">
                          {folder.latestCapture
                            ? `Latest ${formatDateTime(folder.latestCapture)}`
                            : "Folder is empty"}
                        </span>
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-primary">
                      Open folder <ChevronRight className="h-4 w-4" />
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FolderOpen}
            title="No employees match these filters"
            description="Try another employee or team filter."
          />
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedFolderId(null);
                setScreenshotPage(1);
                setOpenIdx(null);
              }}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to folders
            </Button>
            <div className="flex items-center gap-3 text-sm">
              <CalendarDays className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedFolder?.employeeName ?? empOf(selectedFolderId)}
              </span>
              <span className="text-muted-foreground">{date}</span>
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                {shots.data?.total ?? selectedFolder?.screenshotCount ?? 0} screenshots
              </span>
            </div>
          </div>

          {shots.isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="aspect-video animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : shots.isError ? (
            <EmptyState
              icon={ImageOff}
              title="Screenshots couldn't be loaded"
              description="Check the API connection and try again."
              action={<Button onClick={() => shots.refetch()}>Retry</Button>}
            />
          ) : visibleShots.length ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visibleShots.map((shot, index) => (
                <button
                  key={shot.id}
                  onClick={() => setOpenIdx(index)}
                  className="group overflow-hidden rounded-2xl border bg-card p-2 text-left transition duration-200 hover:-translate-y-1 hover:border-primary/25 hover:shadow-lg"
                >
                  <div className="aspect-video overflow-hidden rounded-xl bg-muted ring-1 ring-border">
                    {failedIds.has(shot.id) ? (
                      <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">
                        <ImageOff className="h-6 w-6" />
                      </div>
                    ) : (
                      <ProtectedImage
                        src={shot.thumbnailUrl}
                        alt=""
                        onLoadError={() =>
                          setFailedIds((previous) => new Set(previous).add(shot.id))
                        }
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                      />
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-3 text-xs">
                    <div className="truncate">
                      <div className="truncate font-medium text-foreground">
                        {shot.displayName || "Captured screen"}
                      </div>
                      <div className="truncate text-muted-foreground">
                        {formatDateTime(shot.capturedAt)}
                      </div>
                    </div>
                    {shot.isIdle && <StatusBadge status="idle" />}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={FolderOpen}
              title={
                selectedFolder?.worked ? "No screenshots captured" : "Did not work on this day"
              }
              description={
                selectedFolder?.worked
                  ? "A work session exists, but no screenshots were captured for the selected filters."
                  : `No work session or screenshots were recorded on ${date}.`
              }
            />
          )}
        </div>
      )}

      {((!selectedFolderId && folders.data && folders.data.pages > 1) ||
        (selectedFolderId && shots.data && shots.data.pages > 1)) && (
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {selectedFolderId ? shots.data?.page : folders.data?.page} of{" "}
            {selectedFolderId ? shots.data?.pages : folders.data?.pages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={
                (selectedFolderId ? screenshotPage : folderPage) <= 1 ||
                (selectedFolderId ? shots.isFetching : folders.isFetching)
              }
              onClick={() =>
                selectedFolderId
                  ? setScreenshotPage((currentPage) => currentPage - 1)
                  : setFolderPage((currentPage) => currentPage - 1)
              }
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={
                (selectedFolderId
                  ? screenshotPage >= (shots.data?.pages ?? 1)
                  : folderPage >= (folders.data?.pages ?? 1)) ||
                (selectedFolderId ? shots.isFetching : folders.isFetching)
              }
              onClick={() =>
                selectedFolderId
                  ? setScreenshotPage((currentPage) => currentPage + 1)
                  : setFolderPage((currentPage) => currentPage + 1)
              }
            >
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={current !== null} onOpenChange={(open) => !open && setOpenIdx(null)}>
        <DialogContent className="max-w-4xl">
          <DialogTitle className="sr-only">Screenshot preview</DialogTitle>
          {current && (
            <div>
              <ProtectedImage
                src={current.fullUrl}
                alt=""
                eager
                className="w-full rounded-md ring-1 ring-border"
              />
              <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm">
                  <div className="font-medium">
                    {empOf(current.employeeId)} - {teamOf(current.teamId)}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {taskOf(current)?.projectName ?? "No project"} -{" "}
                    {taskOf(current)?.name ?? "No task"}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {formatDateTime(current.capturedAt)} -{" "}
                    {current.sessionId ? `Session ${current.sessionId}` : "Independent capture"}
                  </div>
                  {current.displayName && (
                    <div className="text-muted-foreground text-xs">
                      Display: {current.displayName}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenIdx((index) => Math.max(0, (index ?? 0) - 1))}
                    disabled={openIdx === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setOpenIdx((index) => Math.min(visibleShots.length - 1, (index ?? 0) + 1))
                    }
                    disabled={openIdx === visibleShots.length - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadScreenshot(current).catch((error) =>
                        toast.error(error instanceof Error ? error.message : "Download failed"),
                      )
                    }
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </Button>
                  {canManageScreenshots && (
                    <Button
                      variant="destructive"
                      size="sm"
                      loading={deleteMutation.isPending}
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(current.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          <DialogTitle>Screenshot capture audit</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Server-recorded capture attempts and the exact reason a screenshot was skipped.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border">
            {captureAudit.isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading audit…</div>
            ) : captureAudit.isError ? (
              <div className="p-8 text-center text-sm text-destructive">
                Capture audit could not be loaded.
              </div>
            ) : captureAudit.data?.length ? (
              <div className="divide-y">
                {captureAudit.data.map((event) => (
                  <div
                    key={event.id}
                    className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1.1fr_1fr_1fr_auto] sm:items-center"
                  >
                    <div>
                      <p className="font-semibold">{event.employeeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(event.occurredAt)}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium capitalize">{event.outcome}</p>
                      <p className="text-xs text-muted-foreground">
                        {event.reason?.replaceAll("_", " ") || "Screenshot stored"}
                      </p>
                    </div>
                    <div className="text-xs capitalize text-muted-foreground">
                      <p>{event.workCategory.replaceAll("_", " ")}</p>
                      <p>Power: {event.powerSource}</p>
                    </div>
                    <StatusBadge status={event.outcome === "captured" ? "active" : "idle"} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No capture attempts match the current employee/date filters.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
