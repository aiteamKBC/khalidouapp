import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listArchivedEmployees, restorePerson, type ArchivedEmployee } from "@/api/people";
import { ARCHIVE_REASON_LABELS } from "@/lib/employee-archive";
import { formatDate, formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";

export const Route = createFileRoute("/_app/archived-employees")({
  component: ArchivedEmployeesPage,
});

function ArchivedEmployeesPage() {
  const { can } = useAuth();
  const canView = can(permissions.peopleView);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const archived = useQuery({
    queryKey: ["archived-employees", search.trim()],
    queryFn: ({ signal }) => listArchivedEmployees(search, signal),
    enabled: canView,
    placeholderData: (previous) => previous,
  });

  const restore = useMutation({
    mutationFn: (employee: ArchivedEmployee) =>
      employee.adminUserId
        ? restorePerson("admin", employee.adminUserId)
        : restorePerson("employee", employee.id),
    onSuccess: async (_, employee) => {
      toast.success(`${employee.name} restored. They need to sign in to the desktop app again.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["archived-employees"] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
        queryClient.invalidateQueries({ queryKey: ["employee"] }),
        queryClient.invalidateQueries({ queryKey: ["users"] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Failed to restore employee"),
  });

  if (!canView) return <Navigate to="/dashboard" replace />;

  const rows = archived.data?.employees ?? [];
  const canRestore = archived.data?.canRestore === true;

  return (
    <div className="studio-page">
      <PageHeader
        title="Archived employees"
        description="Fired or resigned employees. They are hidden from current views and were paid only through their last working day; closed payroll keeps their records."
      />
      <Card className="mb-4 p-4">
        <Input
          value={search}
          placeholder="Search by name, email, or employee code"
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-md"
        />
      </Card>
      {archived.isError ? (
        <Card className="p-6 text-sm text-destructive">
          {archived.error instanceof Error
            ? archived.error.message
            : "Failed to load archived employees."}
        </Card>
      ) : !archived.isLoading && rows.length === 0 ? (
        <EmptyState
          icon={Archive}
          title={search.trim() ? "No archived employees match" : "No archived employees"}
          description="Employees archived by HR as fired or resigned appear here."
        />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Last working day</TableHead>
                <TableHead>Archived</TableHead>
                <TableHead>Archived by</TableHead>
                {canRestore && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {archived.isLoading ? (
                <TableRow>
                  <TableCell colSpan={canRestore ? 6 : 5} className="text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell>
                      <Link
                        to="/employees/$employeeId"
                        params={{ employeeId: employee.id }}
                        className="font-medium hover:underline"
                      >
                        {employee.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {employee.email} · {employee.code}
                        {employee.jobTitle ? ` · ${employee.jobTitle}` : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      {employee.archiveReason ? ARCHIVE_REASON_LABELS[employee.archiveReason] : "—"}
                    </TableCell>
                    <TableCell>
                      {employee.lastWorkingDay
                        ? formatDate(`${employee.lastWorkingDay}T00:00:00`)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {employee.archivedAt ? formatDateTime(employee.archivedAt) : "—"}
                    </TableCell>
                    <TableCell>{employee.archivedByName ?? "—"}</TableCell>
                    {canRestore && (
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={restore.isPending}
                          onClick={() => restore.mutate(employee)}
                        >
                          <ArchiveRestore className="mr-2 h-4 w-4" />
                          Restore
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
