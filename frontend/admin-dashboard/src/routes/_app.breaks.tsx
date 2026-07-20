import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Coffee } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { listEmployees, getWorkProfile } from "@/api/employees";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/breaks")({ component: BreaksPage });

function BreaksPage() {
  const { scopedTeamIds } = useAuth();
  const scope = scopedTeamIds();
  const rows = useQuery({
    queryKey: ["break-profiles", scope],
    queryFn: async () => {
      const employees = await listEmployees(scope);
      return Promise.all(
        employees.map(async (employee) => ({
          employee,
          profile: await getWorkProfile(employee.id),
        })),
      );
    },
  });

  const people = rows.data ?? [];

  return (
    <div className="studio-page">
      <PageHeader
        title="Breaks"
        description="Configured break allowances for employees in your team scope."
      />

      {rows.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : rows.isError ? (
        <EmptyState
          icon={Coffee}
          title="Breaks couldn't be loaded"
          description="Check the API connection and try again."
          action={<Button onClick={() => rows.refetch()}>Retry</Button>}
        />
      ) : people.length === 0 ? (
        <EmptyState
          icon={Coffee}
          title="No employees in scope"
          description="Break allowances will appear here once employees are assigned to your teams."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {people.map(({ employee, profile }) => (
            <Card key={employee.id} className="p-4">
              <div className="mb-3 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Coffee className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-extrabold">{employee.name}</p>
                  <p className="text-xs text-muted-foreground">{employee.email}</p>
                </div>
              </div>
              <div className="space-y-2">
                {(profile.breakRules ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No break rules configured.</p>
                ) : (
                  (profile.breakRules ?? []).map((rule) => (
                    <div
                      key={rule.name}
                      className="flex items-center justify-between rounded-xl border bg-muted/25 px-3 py-2 text-sm"
                    >
                      <span>{rule.name}</span>
                      <strong>
                        {rule.minutes} min · {rule.paid ? "Paid" : "Unpaid"}
                      </strong>
                    </div>
                  ))
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
