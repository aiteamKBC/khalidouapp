import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ImageOff, Trash2 } from "lucide-react";
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
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import type { Screenshot } from "@/types";

export const Route = createFileRoute("/_app/screenshots")({
  component: ScreenshotsPage,
});

function ScreenshotsPage() {
  const { scopedTeamIds, hasRole } = useAuth();
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

  useEffect(() => setPage(1), [empId, teamId, date]);

  const filtered = shots.data?.items ?? [];

  const current = openIdx != null ? filtered[openIdx] : null;
  const empOf = (id: string) =>
    (emps.data ?? []).find((employee) => employee.id === id)?.name ?? "-";
  const teamOf = (id: string) => (teams.data ?? []).find((team) => team.id === id)?.name ?? "-";
  const taskOf = (screenshot: Screenshot) =>
    (tasks.data ?? []).find((task) => task.id === screenshot.taskId);

  return (
    <div>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((shot, index) => (
            <button key={shot.id} onClick={() => setOpenIdx(index)} className="group text-left">
              <div className="aspect-video overflow-hidden rounded-md ring-1 ring-border bg-muted">
                {failedIds.has(shot.id) ? (
                  <div className="grid h-full w-full place-items-center text-xs text-muted-foreground">
                    <ImageOff className="h-6 w-6" />
                  </div>
                ) : (
                  <ProtectedImage
                    src={shot.thumbnailUrl}
                    alt=""
                    onLoadError={() => setFailedIds((previous) => new Set(previous).add(shot.id))}
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                  />
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
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
                      setOpenIdx((index) => Math.min(filtered.length - 1, (index ?? 0) + 1))
                    }
                    disabled={openIdx === filtered.length - 1}
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
                  {hasRole("general_admin") && (
                    <Button
                      variant="destructive"
                      size="sm"
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
