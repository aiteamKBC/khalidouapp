import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Folder, ImageOff, Trash2 } from "lucide-react";
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
import { deleteScreenshot, downloadScreenshot, listScreenshotPage } from "@/api/screenshots";
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
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const shots = useQuery({
    queryKey: ["screenshots", scope, page, empId, teamId, date],
    queryFn: () =>
      listScreenshotPage({
        scopedTeamIds: scope,
        page,
        employeeId: empId,
        teamId,
        day: date || undefined,
      }),
  });
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());

  const deleteMutation = useMutation({
    mutationFn: deleteScreenshot,
    onSuccess: async (result) => {
      toast.success(
        result.deductedMinutes > 0
          ? `Screenshot deleted and ${result.deductedMinutes} tracked minutes deducted`
          : "Screenshot deleted",
      );
      setOpenIdx(null);
      await queryClient.invalidateQueries({ queryKey: ["screenshots"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to delete screenshot"),
  });

  useEffect(() => {
    setPage(1);
    setSelectedFolderId(null);
    setOpenIdx(null);
  }, [empId, teamId, date]);

  const filtered = shots.data?.items ?? [];

  const current = openIdx != null ? filtered.filter((shot) => !selectedFolderId || shot.employeeId === selectedFolderId)[openIdx] : null;
  const empOf = (id: string) =>
    (emps.data ?? []).find((employee) => employee.id === id)?.name ?? "-";
  const teamOf = (id: string) => (teams.data ?? []).find((team) => team.id === id)?.name ?? "-";
  const taskOf = (screenshot: Screenshot) =>
    (tasks.data ?? []).find((task) => task.id === screenshot.taskId);
  const groupedShots = [
    ...filtered
      .reduce((groups, shot) => {
        groups.set(shot.employeeId, [...(groups.get(shot.employeeId) ?? []), shot]);
        return groups;
      }, new Map<string, Screenshot[]>())
      .entries(),
  ]
    .map(([employeeId, items]) => ({
      employeeId,
      employeeName: empOf(employeeId),
      items: [...items].sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt)),
    }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const selectedFolder = selectedFolderId
    ? groupedShots.find((group) => group.employeeId === selectedFolderId)
    : null;
  const visibleShots = selectedFolder ? selectedFolder.items : filtered;

  return (
    <div className="studio-page">
      <PageHeader
        title="Screenshots"
        description={`Review captured screenshots with filters and quick preview${shots.data ? ` · ${shots.data.total} total` : ""}.`}
      />

      <Card className="p-4 mb-4">
        <div className="grid gap-3 sm:grid-cols-4">
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
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <Button
            variant="outline"
            onClick={() => {
              setEmpId("all");
              setTeamId("all");
              setDate("");
            }}
          >
            Reset
          </Button>
        </div>
      </Card>

      {shots.isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="aspect-video rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      ) : shots.isError ? (
        <EmptyState
          icon={ImageOff}
          title="Screenshots couldn't be loaded"
          description="Check the API connection and try again."
          action={<Button onClick={() => shots.refetch()}>Retry</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ImageOff}
          title="No screenshots"
          description="Try adjusting the filters or check back later."
        />
      ) : (
        <>
          {!selectedFolder ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {groupedShots.map((group) => (
                <button
                  key={group.employeeId}
                  type="button"
                  onClick={() => {
                    setSelectedFolderId(group.employeeId);
                    setOpenIdx(null);
                  }}
                  className="group rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:-translate-y-1 hover:border-primary/30 hover:shadow-lg"
                >
                  <div className="relative h-36 overflow-hidden rounded-2xl bg-muted">
                    <div className="absolute left-4 top-4 z-10 grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                      <Folder className="h-7 w-7" />
                    </div>
                    <div className="absolute bottom-3 right-3 grid grid-cols-3 gap-1">
                      {group.items.slice(0, 3).map((shot, index) => (
                        <div
                          key={shot.id}
                          className="h-16 w-24 overflow-hidden rounded-lg border-2 border-card bg-card shadow-md"
                          style={{ transform: `rotate(${(index - 1) * 3}deg)` }}
                        >
                          <ProtectedImage
                            src={shot.thumbnailUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-extrabold text-primary">
                      {initials(group.employeeName)}
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-extrabold">{group.employeeName}</h3>
                      <p className="text-xs text-muted-foreground">
                        {group.items.length} screenshots · latest {formatDateTime(group.items[0].capturedAt)}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedFolderId(null);
                    setOpenIdx(null);
                  }}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to folders
                </Button>
                <div className="text-sm text-muted-foreground">
                  {selectedFolder.employeeName} · {selectedFolder.items.length} screenshots
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleShots.map((shot, index) => (
                  <button
                    key={shot.id}
                    onClick={() => setOpenIdx(index)}
                    className="group overflow-hidden rounded-2xl border bg-card p-2 text-left transition duration-200 hover:-translate-y-1 hover:border-[#e5185d]/25 hover:shadow-lg"
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
            </div>
          )}

          <div className="hidden grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((shot, index) => (
            <button
              key={shot.id}
              onClick={() => setOpenIdx(index)}
              className="studio-card group overflow-hidden rounded-2xl border bg-card p-2 text-left transition duration-200 hover:-translate-y-1 hover:border-[#e5185d]/25 hover:shadow-lg"
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
                    onLoadError={() => setFailedIds((previous) => new Set(previous).add(shot.id))}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                )}
              </div>
              <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-3 text-xs">
                <div className="truncate">
                  <div className="font-medium text-foreground truncate">
                    {empOf(shot.employeeId)}
                  </div>
                  <div className="text-muted-foreground truncate">
                    {shot.displayName ? `${shot.displayName} · ` : ""}
                    {formatDateTime(shot.capturedAt)}
                  </div>
                </div>
                {shot.isIdle && <StatusBadge status="idle" />}
              </div>
            </button>
          ))}
          </div>
        </>
      )}

      {shots.data && shots.data.pages > 1 && (
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Page {shots.data.page} of {shots.data.pages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || shots.isFetching}
              onClick={() => setPage((currentPage) => currentPage - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= shots.data.pages || shots.isFetching}
              onClick={() => setPage((currentPage) => currentPage + 1)}
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
                    {formatDateTime(current.capturedAt)} - Session {current.sessionId}
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
    </div>
  );
}
