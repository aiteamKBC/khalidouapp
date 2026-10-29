# Khaliduo end-to-end tests

Two suites are available: desktop native tests with controlled service replies, and full-stack tests that run the backend, website and desktop against a throwaway local Postgres.

## Desktop native suite (no Docker)

Run on Windows in an interactive desktop session. Install dependencies in both
`frontend/desktop-agent` and `e2e` with `npm ci`. Electron supplies its own browser;
the native suite does not require a separate Chromium download or backend setup.

```powershell
cd e2e
npm.cmd run e2e:desktop:native         # build the current app, then run all native tests
npm.cmd run typecheck                 # check all E2E TypeScript
npm.cmd run e2e:desktop:native:report  # open the native HTML report

# After building, run a subset without rebuilding:
npx.cmd playwright test --config desktop-native.config.ts tracking.spec.ts
npx.cmd playwright test --config desktop-native.config.ts --grep "quote"
```

The 54 independent scenarios cover:

| Area | Checks | File |
|---|---|---|
| Idle tracking | Fifteen-minute boundary, eligible idle, Continue/Stop, one event per transition, fresh threshold after returning | `native/tracking.spec.ts` |
| Breaks and pauses | Frozen work counters, separate break accumulation, saved preferences and reload, 45-minute warning, 60-minute shift stop, scheduled and saved breaks | `native/tracking.spec.ts` |
| Power and connectivity | Lock/sleep accrual and capture gates, battery/AC, responsive offline pause/resume and sync against the transport fixture | `native/tracking.spec.ts` |
| Tasks | Team/project filtering, create/retry with draft preservation, selection, stages, checklist add/complete/delete, completion notes, tracker quick creation | `native/workspace.spec.ts` |
| Time and leave requests | Idle explanation from a completed episode, service failure/retry, early-leave allowance, annual-leave calculations, history filters/details, Escape/focus restoration | `native/workspace.spec.ts` |
| Rescheduling | Working-day selection, same-length shifts, midnight overflow, submit and cancel | `native/workspace.spec.ts` |
| Meetings | Start/end, recorded time, silent inactivity, deadline auto-end from another screen, failed start/retry and failed-sync UI | `native/workspace.spec.ts` |
| Screenshots and summaries | Empty/disabled/error states, capture rendering, refresh and portal handoff action, Shift and Insights totals | `native/workspace.spec.ts` |
| Account and tracking start | Cancelled sign-out, sign-out, invalid/valid credentials, password visibility/clearing, password help, inside/outside-shift prompts | `native/shell.spec.ts` |
| Appearance | Six palettes, five timer faces, persistence after renderer reload | `native/shell.spec.ts` |
| Quotes | Interval validation and persistence, opt-out, actual scheduled native window, bottom-right placement, minimized workspace, translation, Tajawal Arabic, attribution and dismissal | `native/shell.spec.ts` |
| External quotes | Arabic/English feeds, English provider rotation, real feed-client batch rotation, author/source credit, Tajawal Arabic, source action and provider failure fallback | `native/quote-feed.spec.ts` |
| Desktop shell | Native close request deduplication/reload, focus trap, cancellation, hide/pause/resume/quit choices and retry, maximize/restore, square expanded frame, compact layouts down to 460×360 | `native/shell.spec.ts` |
| Updates | Check error, download progress, disabled controls, install action | `native/shell.spec.ts` |
| UI regressions | Idle/paid-break/overtime clock values, separate daily progress, zero-target ring, All projects selection, offline screenshot labels, account-switch cache isolation and delayed replies | `native/ui-regressions.spec.ts` |

Each test launches a fresh Electron process with its own profile under
`native-results/`. Failures retain a trace, screenshot and native-state attachment;
the host also checks for uncaught renderer errors and tracking errors. There are
no shared accounts or developer profile writes. The host never loads `.env`.
Backend and quote-provider HTTP replies are fixtures, and installer/external-browser
actions are recorded rather than executed.

### What the native suite proves

The built React renderer and actual preload communicate over real Electron IPC.
The test host (`frontend/desktop-agent/e2e/support/native-runtime.mjs`) reuses the
existing TypeScript source harness to execute current production tracking,
idle/break, preference persistence, meeting-deadline and window-close functions.
The production `createMainWindow` and quote-window service create the native
windows. A controlled clock advances tracking one second at a time, so a
one-hour break can be tested in seconds without skipping accounting checkpoints.

Backend replies, meeting storage, session start/stop transport, update services,
and OS input/power observations are fixtures. The offline queue in this host is
a transport fixture: its assertions do **not** prove production SQLite recovery
or server replay. Authentication tests check the desktop flow and payloads,
not server credential verification. Meeting approval/payroll, real screen
capture, input-probe hardware, tray menus, actual OS sleep/lock callbacks,
single-instance handover and installer execution require the full-stack suite,
existing service tests, or manual checks on a packaged build. The native host is
outside `electron/` and is excluded from the installer.

## Full-stack suite

These tests run the **backend, website and Electron desktop app together**.
Every service URL is checked by `assertIsolated()` before a process starts.

## Prerequisites

- Docker Desktop running
- `backend/.venv` set up (the normal backend dev setup)
- `npm install` done in `frontend/admin-dashboard` and `frontend/desktop-agent`
- In `e2e/`: `npm install` and `npx playwright install chromium`
- A built desktop app: `npm run build:desktop` (rebuild after changing desktop code)

## Run

```sh
cd e2e
npm run e2e            # everything
npm run e2e:journey    # the full workday, desktop + website (~15 min)
npm run e2e:web        # website: auth, permissions matrix, admin workflows
npm run e2e:desktop    # desktop: smoke + edge cases
npm run e2e:report     # open the HTML report (traces, screenshots, videos on failure)
```

Each run starts a fresh stack (`global-setup.ts`) and tears it down afterwards.

For fast iteration, keep one stack up and reuse it:

```sh
node lib/up.ts                                   # start once
E2E_REUSE_STACK=1 npx playwright test web/auth.spec.ts
node lib/down.ts                                 # stop
```

Note that reusing a stack keeps earlier data. The journey expects a fresh database (Dina must have no open session), so restart the stack before rerunning it.

## What runs where

| Piece | Where | Notes |
|---|---|---|
| Postgres 16 | Docker `khaliduo-e2e-postgres`, `127.0.0.1:55432` | tmpfs, so each run starts empty |
| Backend | `127.0.0.1:8010` | started with cwd `e2e/.runtime`, so `backend/.env` (production) is never read |
| Desktop proxy | `127.0.0.1:8011` | sits between the app and the backend; tests switch it offline or make it return a fixed status |
| Website | `127.0.0.1:5175` | Vite dev server with `VITE_API_BASE_URL` pointing at 8010 |
| Desktop app | built `dist-electron-khaliduo`, launched by Playwright | throwaway profile per simulated computer (`KHALIDUO_E2E_USER_DATA_DIR`) |

Logs are in `e2e/.runtime/logs/`, and seeded ids and credentials in `e2e/.runtime/seed.json`.

## Seed (`seed/seed_e2e.py`)

- Company "Khaliduo E2E" (Africa/Cairo) with saved breaks switched on (a financial policy period since 1 January), an idle threshold of 1 minute, and screenshots off.
- Admins: `super`, `hr`, `lead` (team owner of Team Alpha), and `custom` (custom permissions).
- Employees: `day` (Dina, the journey), `late` (Lamia), `other` (Omar, Team Beta), `archive` (Adel).
- Shifts are built around the moment the suite starts (started 25–30 min ago), so no test waits for a real clock time.

## Native seams

These are faked from the test through `electronApp.evaluate`, with no app code changes:

- **Idle:** `powerMonitor.getSystemIdleTime` is replaced (`desktop.goIdle(s)` / `desktop.becomeActive()`).
- **Lock and sleep:** `powerMonitor.emit(...)`.
- **Native dialogs:** `dialog.showMessageBox` answers from a queue (`desktop.answerNextDialog(i)`).
- **External links:** `shell.openExternal` is recorded (`desktop.openedUrls()`), for example the employee-portal handoff.
- **Network:** the proxy's `setNetwork({ kind: "offline" })`.

The only app change is `KHALIDUO_E2E_USER_DATA_DIR` in `electron/main.ts`. It is honoured in unpackaged runs only, and keeps tests off the developer's real `%APPDATA%\khaliduo-dev` identity.

## Not covered here

- **Auto-update and installer:** these only run in a packaged build and install silently. They are covered by unit tests.
- **Real input-probe checks, real screenshots, and the tray menu UI.**
- **Midnight rollover:** covered by backend pytest.
