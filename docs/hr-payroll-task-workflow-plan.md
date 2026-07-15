# Khaliduo HR, Payroll, Schedule, and Task Workflow Plan

## Non-negotiable Desktop Rules

- Keep Windows startup behavior intact.
- Keep tray behavior intact.
- Keep forced update checks intact.
- Keep tracking, idle detection, screenshots, sync queues, enrollment, and logout logic intact.
- UI changes may call existing desktop APIs, but must not rewrite tracking rules without a separate reviewed change.

## Roles

- Admin: full access, can also be a team lead.
- HR: same payroll, employee profile, salary, and schedule powers as admin.
- Team lead: can approve task requests and completion requests for their team/project, but is not admin.
- Employee: uses the desktop app and employee dashboard, can see their own time and money-related summaries.

## Employee Profile Requirements

Before sending an invitation, the profile must include:

- Work schedule start and end time.
- Working days and weekly days off.
- Daily required hours.
- Break rules.
- Salary amount and currency.
- Late grace period.
- Deduction policy.
- Overtime eligibility and overtime policy.
- Manager/team lead assignment where needed.

Existing employees with missing fields should be marked incomplete until HR/Admin fills them.

## Schedule and Breaks

- Support different shifts, for example 09:00-17:00 and 10:00-18:00.
- Support different weekly off days, for example Friday or Sunday.
- Default late grace period: 15 minutes.
- Break policy is global by default, editable by Admin/HR because timings may change.
- Breaks must support at least one 30-minute break and one 15-minute break.
- Breaks should reduce expected payable/required working calculations according to the selected policy.

## Late, Idle, and Deduction Rules

- Late arrival is calculated against the employee's assigned shift start.
- If the employee is late but completes the expected working time, Admin/HR decides whether to deduct.
- Deductions are minute-based by default.
- Admin/HR can define deduction brackets, for example: X minutes late means Y deducted minutes or Y deducted amount.
- Idle time inside the shift does not automatically deduct salary.
- Idle time should notify the manager/admin for review.
- Manager/Admin decides whether idle time is accepted, rejected, or converted into deduction/manual time.

## Overtime

- Overtime is enabled per employee by Admin/HR.
- Overtime rate is set per employee or policy.
- Admin/HR chooses the overtime basis:
  - Time beyond required daily hours.
  - Time outside assigned shift.
  - Both conditions, if required later.
- Overtime appears in employee view with status: pending, approved, rejected, or paid.

## Payroll

- Default currency: EGP.
- Supported starting currencies: EGP, GBP, USD, EUR, SAR, AED.
- Employee can see their own salary/time/payroll summaries.
- HR/Admin can edit salary, currency, deductions, overtime rules, and payroll approvals.
- Payroll calculation must be explainable: base salary, normal worked time, approved overtime, approved deductions, unpaid absences, and final amount.

## Task Workflow

- Employee can request a new task from the desktop app.
- Request includes task name, project, requested stage, notes, optional deadline.
- Admin or team lead can approve/reject task creation.
- When approved, the task moves to the selected stage.
- Employee can submit task as complete.
- Admin or team lead approves completion before it becomes final.
- Recent tasks must show per-task tracked time while the daily total remains a separate overall number.

## Dashboard Changes

- Employee dashboard: personal screenshots, time, tasks, payroll summary, overtime/deduction status.
- Admin dashboard: company management, employees, teams, schedules, screenshots access, approvals, audit logs.
- HR dashboard: employee profiles, schedules, salary, payroll, deductions, overtime, invitation readiness.
- Team lead dashboard: task approvals, completion approvals, team activity, relevant screenshots if permitted.

## Audit Logs

Record who changed or approved:

- Employee profile data.
- Salary/currency.
- Schedule and break policy.
- Deduction policy.
- Overtime policy.
- Task creation approvals.
- Task completion approvals.
- Manual time and idle decisions.

## Implementation Phases

1. Database models and migrations for profiles, schedules, breaks, payroll policies, overtime, deductions, and audit logs.
2. Backend services for profile completeness, schedule calculations, late/idle/overtime decisions, and payroll previews.
3. Admin/HR dashboard screens for employee profile completion and invitation blocking.
4. Task approval and completion approval workflow in backend and dashboard.
5. Employee dashboard pages for personal time, screenshots, task time, overtime, deductions, and payroll summary.
6. Desktop app UI wiring for task requests, dashboard button, timeline, alerts, and clear status display.
7. End-to-end tests for schedule, late, idle, overtime, payroll preview, and approval permissions.
