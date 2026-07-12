# Khaliduo UI Reference — modeled on Hubstaff

Goal: adopt Hubstaff's **layout, information architecture, and interaction patterns**,
but keep Khaliduo's **brand identity** (navy `--primary`, pink accent, navy sidebar).
Do NOT copy Hubstaff blue. All data stays **dynamic** (real API, react-query).

## Design language (global)
- Left sidebar (navy in our brand), sections: Dashboard, Timesheets, Activity/Live,
  Insights/Reports, Project management, Teams, Screenshots, Settings.
- Sticky top bar with a running **timer pill** (`0:00:00`) + user menu.
- Content background = muted/very-light; cards = white with subtle border, `rounded-lg`.
- Card header pattern: small **UPPERCASE gray label**, then a **large metric**, then a
  tiny trend (`▲1%`) + mini **sparkline**.
- Segmented pill toggles for view switches (Daily / Weekly / Calendar; ME / ALL).
- Tables: light header row, generous row padding, right-aligned `Actions` dropdown.
- Filter **chips with counts**: `Submitted (0)  Approved (43)  Denied (0)  All (43)`.
- Empty states: soft illustration + one-line explanation.

## Screen specs (Hubstaff → our route)

### 1. Desktop agent — Tasks/Timer window  → `desktop-agent`
- Left: big timer `00:50:31`, start/stop circle, "Today: 0:50", project search + list
  with per-project time, org header row.
- Right: **Tasks** panel scoped to selected project; `All tasks` filter, search,
  `Show completed`, `Create a task` inline row, empty state "You have no tasks assigned".
- App menu: Stop Working, Add Time Note, Open Timer, Recent Projects, Sign Out,
  Open Dashboard, Add/Edit Time, Check for Updates, Preferences, Quit.

### 2. Dashboard  → `_app.dashboard.tsx`
- Title + date range (`Mon, Jul 6 – Sun, Jul 12`), **ME / ALL** tabs, `Manage widgets`.
- Row of 3 stat cards, each = UPPERCASE label + big value + trend + sparkline:
  `WEEKLY ACTIVITY 31% ▲1%`, `WORKED THIS WEEK 317:04:09 ▼67:48:31`, `PROJECTS WORKED 1`.
- **Recent activity** card: per-employee rows, 3 screenshot thumbnails each with an
  activity-% badge in the corner, `View all`.
- **Insights** card: Work time classification (Core / Non-core / Unproductive % with
  legend), Activity gauge (avg %), Top core / Low core members lists.
- **Who's online** panel.

### 3. Timesheets → View & edit  → `_app.timesheets.tsx`
- Title `View & edit timesheets`; **Daily / Weekly / Calendar** pill toggle.
- Date-range picker + timezone selector; member selector + `Filters`; `Add time`.
- `Today: 0:46:58` + horizontal **timeline slider** with hour ticks (6am/12pm/6pm)
  showing worked blocks.
- Table columns: **Project | Activity | Idle | Manual | Duration | Time | Actions**.
  Each row: project + org + to-do line, activity %, idle %, manual %, duration ($),
  time span, Actions dropdown.

### 4. Timesheets → Approvals  → `_app.timesheets.tsx` (Approvals tab) / `_app.time-adjustments.tsx`
- Sub-tabs: **TIMESHEETS | MANUAL TIME REQUESTS**.
- Timesheets: per-member weekly grid `Mon Tue Wed Thu Fri Total`, `Details`,
  `Approve` / `Deny` buttons, Prev/Next member paging.

### 5. Approvals → Manual time requests  → `_app.time-adjustments.tsx`
- `Request manual time` button (top-right).
- Filters: All teams / All members, date range, timezone.
- Chips with counts: Submitted / Approved / Denied / All.
- Table: **Member | Project/Work order | Date | Time span | Duration | Status | Requested on**.
- Pagination `Showing … 20 per page`.

## Status: awaiting more screenshots for Activity, Insights/Reports, Projects, Teams,
## Members, Calendar, Expenses, Settings.
