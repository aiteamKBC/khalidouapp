import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { listEmployees } from "@/api/employees";
import { ApplicationHistoryPanel } from "@/components/application-history-panel";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/history")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    employeeId?: string;
    day?: string;
  } => ({
    employeeId:
      typeof search.employeeId === "string" && search.employeeId ? search.employeeId : undefined,
    day: typeof search.day === "string" && search.day ? search.day : undefined,
  }),
  component: ApplicationHistoryPage,
});

function todayIsoDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function ApplicationHistoryPage() {
  const search = Route.useSearch();
  const { scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const employees = useQuery({
    queryKey: ["employees", scope],
    queryFn: ({ signal }) => listEmployees(scope, signal),
    staleTime: 30_000,
  });
  const [employeeId, setEmployeeId] = useState(search.employeeId ?? "");
  const [day, setDay] = useState(search.day ?? todayIsoDate());

  useEffect(() => {
    if (search.employeeId) setEmployeeId(search.employeeId);
    if (search.day) setDay(search.day);
  }, [search.day, search.employeeId]);

  useEffect(() => {
    if (!employeeId && employees.data?.[0]) {
      setEmployeeId(employees.data[0].id);
    }
  }, [employeeId, employees.data]);

  return (
    <div className="studio-page">
      <PageHeader
        title="Application & website history"
        description="Review which programs and website domains were active for an employee on a selected workday."
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="w-full space-y-1 sm:w-80">
            <Label>Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an employee" />
              </SelectTrigger>
              <SelectContent>
                {(employees.data ?? []).map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {employeeId ? (
        <ApplicationHistoryPanel employeeId={employeeId} day={day} onDayChange={setDay} />
      ) : (
        <EmptyState
          icon={History}
          title={employees.isLoading ? "Loading employees..." : "No employee selected"}
          description={
            employees.isLoading
              ? "The employee directory is loading."
              : "Choose an employee to view application and website history."
          }
        />
      )}
    </div>
  );
}
