import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Coffee } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
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
      return Promise.all(employees.map(async (employee) => ({ employee, profile: await getWorkProfile(employee.id) })));
    },
  });
  return <div className="studio-page">
    <PageHeader title="Breaks" description="Configured break allowances for employees in your team scope." />
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">{(rows.data ?? []).map(({ employee, profile }) => <Card key={employee.id} className="p-4"><div className="mb-3 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Coffee className="h-5 w-5" /></span><div><p className="font-extrabold">{employee.name}</p><p className="text-xs text-muted-foreground">{employee.email}</p></div></div><div className="space-y-2">{(profile.breakRules ?? []).map((rule) => <div key={rule.name} className="flex items-center justify-between rounded-xl border bg-muted/25 px-3 py-2 text-sm"><span>{rule.name}</span><strong>{rule.minutes} min · {rule.paid ? "Paid" : "Unpaid"}</strong></div>)}</div></Card>)}</div>
  </div>;
}
