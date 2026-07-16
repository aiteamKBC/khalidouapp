import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Banknote, Send } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getPayrollPreview,
  getWorkProfile,
  listEmployees,
  sendEmployeeInvitation,
  updateWorkProfile,
  type WorkProfileInput,
} from "@/api/employees";
import { useAuth } from "@/lib/auth";
import { formatMinutes } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/payroll")({
  component: PayrollPage,
});

const weekdays = [
  ["Mon", 0],
  ["Tue", 1],
  ["Wed", 2],
  ["Thu", 3],
  ["Fri", 4],
  ["Sat", 5],
  ["Sun", 6],
] as const;

function PayrollPage() {
  const { scopedTeamIds, can } = useAuth();
  const queryClient = useQueryClient();
  const employees = useQuery({
    queryKey: ["employees", scopedTeamIds()],
    queryFn: () => listEmployees(scopedTeamIds()),
  });
  const [employeeId, setEmployeeId] = useState("");
  const selectedEmployee = (employees.data ?? []).find((employee) => employee.id === employeeId);
  const profile = useQuery({
    queryKey: ["employee-work-profile", employeeId],
    queryFn: () => getWorkProfile(employeeId),
    enabled: Boolean(employeeId),
  });
  const preview = useQuery({
    queryKey: ["employee-payroll-preview", employeeId],
    queryFn: () => getPayrollPreview(employeeId),
    enabled: Boolean(employeeId),
  });
  const [form, setForm] = useState<WorkProfileInput>({});

  useEffect(() => {
    if (!employeeId && employees.data?.[0]) setEmployeeId(employees.data[0].id);
  }, [employeeId, employees.data]);

  useEffect(() => {
    if (!profile.data) return;
    setForm({
      shiftStart: profile.data.shiftStart ?? "09:00",
      shiftEnd: profile.data.shiftEnd ?? "17:00",
      workingDays: profile.data.workingDays ?? [0, 1, 2, 3, 4],
      weeklyOffDays: profile.data.weeklyOffDays ?? [5, 6],
      requiredDailyMinutes: profile.data.requiredDailyMinutes ?? 480,
      breakRules: profile.data.breakRules ?? [
        { name: "Lunch", minutes: 30, paid: false },
        { name: "Short break", minutes: 15, paid: false },
      ],
      lateGraceMinutes: profile.data.lateGraceMinutes ?? 15,
      deductionPolicy: profile.data.deductionPolicy ?? {
        mode: "review",
        require_admin_review: true,
        brackets: [{ after_minutes: 15, deduct_minutes: 1, note: "Review by minute" }],
      },
      overtimeEnabled: profile.data.overtimeEnabled,
      overtimeBasis: profile.data.overtimeBasis ?? "beyond_daily_required",
      overtimeRateMultiplier: profile.data.overtimeRateMultiplier ?? 1.5,
      salaryAmount: profile.data.salaryAmount ?? 0,
      salaryCurrency: profile.data.salaryCurrency ?? "EGP",
    });
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => updateWorkProfile(employeeId, form),
    onSuccess: () => {
      toast.success("Work profile saved");
      void queryClient.invalidateQueries({ queryKey: ["employee-work-profile", employeeId] });
      void queryClient.invalidateQueries({ queryKey: ["employee-payroll-preview", employeeId] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save profile"),
  });

  const invite = useMutation({
    mutationFn: () => sendEmployeeInvitation(employeeId),
    onSuccess: () => {
      toast.success("Invitation sent");
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not send invitation"),
  });

  const missing = profile.data?.completeness.missing_fields ?? [];
  const canManage = can("payroll.manage");
  const employeeOptions = useMemo(() => employees.data ?? [], [employees.data]);

  return (
    <div className="studio-page-medium">
      <PageHeader
        title="Payroll and work profiles"
        description="Complete schedules, breaks, salary, overtime and deduction rules before inviting employees."
        actions={
          selectedEmployee && (
            <Button asChild variant="outline">
              <Link to="/employees/$employeeId" params={{ employeeId: selectedEmployee.id }}>
                Open employee
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Employee</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose employee" />
              </SelectTrigger>
              <SelectContent>
                {employeeOptions.map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {employee.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedEmployee && (
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium">{selectedEmployee.name}</div>
                <div className="text-muted-foreground">{selectedEmployee.email}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {profile.data?.completeness.complete
                    ? "Profile complete"
                    : `${missing.length} missing fields`}
                </div>
              </div>
            )}
            <Button
              className="w-full"
              variant={profile.data?.completeness.complete ? "default" : "outline"}
              disabled={!employeeId || !profile.data?.completeness.complete || invite.isPending}
              onClick={() => invite.mutate()}
            >
              <Send className="mr-2 h-4 w-4" />
              {invite.isPending ? "Sending..." : "Send invitation"}
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {missing.length > 0 && (
            <Card className="border-warning/40 bg-warning/5">
              <CardContent className="p-4 text-sm">
                Missing before invitation: <span className="font-medium">{missing.join(", ")}</span>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Schedule and breaks</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Shift start">
                <Input
                  type="time"
                  value={form.shiftStart ?? ""}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, shiftStart: event.target.value })}
                />
              </Field>
              <Field label="Shift end">
                <Input
                  type="time"
                  value={form.shiftEnd ?? ""}
                  disabled={!canManage}
                  onChange={(event) => setForm({ ...form, shiftEnd: event.target.value })}
                />
              </Field>
              <Field label="Required daily minutes">
                <Input
                  type="number"
                  value={form.requiredDailyMinutes ?? 480}
                  disabled={!canManage}
                  onChange={(event) =>
                    setForm({ ...form, requiredDailyMinutes: Number(event.target.value) })
                  }
                />
              </Field>
              <Field label="Late grace minutes">
                <Input
                  type="number"
                  value={form.lateGraceMinutes ?? 15}
                  disabled={!canManage}
                  onChange={(event) =>
                    setForm({ ...form, lateGraceMinutes: Number(event.target.value) })
                  }
                />
              </Field>
              <div>
                <Label>Working days</Label>
                <DayPicker
                  value={form.workingDays ?? []}
                  disabled={!canManage}
                  onChange={(workingDays) => setForm({ ...form, workingDays })}
                />
              </div>
              <div>
                <Label>Weekly off days</Label>
                <DayPicker
                  value={form.weeklyOffDays ?? []}
                  disabled={!canManage}
                  onChange={(weeklyOffDays) => setForm({ ...form, weeklyOffDays })}
                />
              </div>
              <Field label="30 minute break">
                <Input
                  type="number"
                  value={form.breakRules?.[0]?.minutes ?? 30}
                  disabled={!canManage}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      breakRules: [
                        { name: "Lunch", minutes: Number(event.target.value), paid: false },
                        {
                          name: "Short break",
                          minutes: form.breakRules?.[1]?.minutes ?? 15,
                          paid: false,
                        },
                      ],
                    })
                  }
                />
              </Field>
              <Field label="Short break">
                <Input
                  type="number"
                  value={form.breakRules?.[1]?.minutes ?? 15}
                  disabled={!canManage}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      breakRules: [
                        {
                          name: "Lunch",
                          minutes: form.breakRules?.[0]?.minutes ?? 30,
                          paid: false,
                        },
                        { name: "Short break", minutes: Number(event.target.value), paid: false },
                      ],
                    })
                  }
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Salary, deductions and overtime</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <Field label="Salary amount">
                <Input
                  type="number"
                  value={form.salaryAmount ?? 0}
                  disabled={!canManage}
                  onChange={(event) =>
                    setForm({ ...form, salaryAmount: Number(event.target.value) })
                  }
                />
              </Field>
              <Field label="Currency">
                <Select
                  value={form.salaryCurrency ?? "EGP"}
                  disabled={!canManage}
                  onValueChange={(salaryCurrency) =>
                    setForm({
                      ...form,
                      salaryCurrency: salaryCurrency as WorkProfileInput["salaryCurrency"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["EGP", "GBP", "USD", "EUR", "SAR", "AED"].map((currency) => (
                      <SelectItem key={currency} value={currency}>
                        {currency}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Deduction mode">
                <Select
                  value={form.deductionPolicy?.mode ?? "review"}
                  disabled={!canManage}
                  onValueChange={(mode) =>
                    setForm({
                      ...form,
                      deductionPolicy: {
                        mode: mode as "review" | "per_minute" | "brackets",
                        require_admin_review: true,
                        brackets: form.deductionPolicy?.brackets ?? [],
                      },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="review">Manager review</SelectItem>
                    <SelectItem value="per_minute">By minute</SelectItem>
                    <SelectItem value="brackets">Brackets</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.overtimeEnabled === true}
                  disabled={!canManage}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, overtimeEnabled: checked === true })
                  }
                />
                Overtime enabled
              </label>
              <Field label="Overtime basis">
                <Select
                  value={form.overtimeBasis ?? "beyond_daily_required"}
                  disabled={!canManage || !form.overtimeEnabled}
                  onValueChange={(overtimeBasis) =>
                    setForm({
                      ...form,
                      overtimeBasis: overtimeBasis as WorkProfileInput["overtimeBasis"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beyond_daily_required">Beyond daily required</SelectItem>
                    <SelectItem value="outside_shift">Outside shift</SelectItem>
                    <SelectItem value="either">Either</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Overtime multiplier">
                <Input
                  type="number"
                  step="0.1"
                  value={form.overtimeRateMultiplier ?? 1.5}
                  disabled={!canManage || !form.overtimeEnabled}
                  onChange={(event) =>
                    setForm({ ...form, overtimeRateMultiplier: Number(event.target.value) })
                  }
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Preview
                label="Base"
                value={`${preview.data?.base_salary ?? 0} ${preview.data?.currency ?? "EGP"}`}
              />
              <Preview
                label="Required"
                value={formatMinutes(Math.round((preview.data?.required_seconds ?? 0) / 60))}
              />
              <Preview
                label="Paid breaks"
                value={formatMinutes(Math.round((preview.data?.paid_break_seconds ?? 0) / 60))}
              />
              <Preview
                label="Unpaid breaks"
                value={formatMinutes(Math.round((preview.data?.unpaid_break_seconds ?? 0) / 60))}
              />
              <Preview
                label="Tracked"
                value={formatMinutes(Math.round((preview.data?.active_seconds ?? 0) / 60))}
              />
              <Preview
                label="Estimated total"
                value={`${preview.data?.estimated_total ?? 0} ${preview.data?.currency ?? "EGP"}`}
                icon
              />
            </CardContent>
          </Card>

          {canManage && (
            <div className="flex justify-end">
              <Button disabled={!employeeId || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Saving..." : "Save work profile"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function DayPicker({
  value,
  disabled,
  onChange,
}: {
  value: number[];
  disabled: boolean;
  onChange: (value: number[]) => void;
}) {
  return (
    <div className="mt-2 grid grid-cols-4 gap-2">
      {weekdays.map(([label, day]) => (
        <label key={day} className="flex items-center gap-2 rounded-md border p-2 text-xs">
          <Checkbox
            checked={value.includes(day)}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange(
                checked === true
                  ? [...new Set([...value, day])]
                  : value.filter((item) => item !== day),
              )
            }
          />
          {label}
        </label>
      ))}
    </div>
  );
}

function Preview({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon && <Banknote className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}
