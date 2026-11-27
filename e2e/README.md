# Khaliduo end-to-end tests

Automated tests run the **backend, website and Electron desktop app together**, against throwaway local PostgreSQL. Every configured URL is checked by `assertIsolated()` before a process starts. Test accounts, profiles and tokens are separate from the installed app and production employees.

## Prerequisites

- Windows: portable PostgreSQL is downloaded by `backend/.venv/Scripts/python e2e/tools/setup.py` (no installer, service or Docker required). Linux: Docker Compose provides the database.
- `backend/.venv` set up (the normal backend dev setup)
- `npm install` done in `frontend/admin-dashboard` and `frontend/desktop-agent`
- In `e2e/`: `npm install` and `npx playwright install chromium`
- A built desktop app: `npm run build:desktop` (rebuild after changing desktop code)

Install backend test dependencies with `backend/.venv/Scripts/python -m pip install -r backend/requirements-test.txt`.
The setup script downloads pinned PostgreSQL, Toxiproxy and k6 binaries from the
upstream projects, checks their SHA256, and stores them under ignored `.tools/`.
Repeated setup preserves identical running binaries. It never installs a system service.
Windows process cleanup checks the recorded PID plus its immutable creation time,
so recycled PIDs cannot stop another app. Bounded native process/port checks avoid
WMI stalls; failed cleanup retains its manifest and fails the quality report.

## Unified quality gate

From the repository root:

```powershell
./scripts/test-khaliduo.ps1 -Suite all -Profile quick -InstallTools
./scripts/test-khaliduo.ps1 -Suite all -Profile nightly -Seed 20261127
./scripts/test-khaliduo.ps1 -Suite unit -Seed 20261127
./scripts/test-khaliduo.ps1 -Suite integration -Profile nightly
./scripts/test-khaliduo.ps1 -Suite load
```

On Linux the unit suite is `backend/.venv/bin/python scripts/test_khaliduo.py --suite unit`.
The Electron integration/native workflows target Windows.
Quick runs include desktop smoke/edge cases and network chaos; nightly integration
also includes the web permission/workflow tests and the complete employee workday.
Each run writes `test-reports/<run>/summary.json`, per-step logs, pytest JUnit and
k6 metrics. Playwright writes HTML/JUnit, screenshots and traces under `e2e/`;
Electron failure traces are attached for network chaos and the workday journey.
Any failed check produces a nonzero exit. The report includes a hash of the tested
source; changing source while tests run invalidates the report.

The regular quality workflow runs on pull requests/pushes; a larger profile runs
nightly. Production deployment depends on those jobs. The local deployment script
requires `-QualityReport test-reports/<run>/summary.json` from a passing `-Suite all`
run matching the current source, so a stale report cannot authorize changed code.
Local deployment accepts `-IdentityFile` and otherwise uses the project-specific
`~/.ssh/khaliduo_deploy` key when present; it never prompts for or stores a password.

## Generated sequences and replay

`backend/tests/test_time_state_machine.py` uses Hypothesis to generate starts,
country changes, time passage, late heartbeats/stops and duplicate delivery.
After each step it checks event bounds, counter conservation, one open session,
and closed-ledger immutability. `frontend/desktop-agent/tests/timeStateMachine.test.ts`
uses fast-check against the actual main-process accrual and input-monitor code,
including physical/injected input, probe restart, clock changes, pauses and freezes.

Quick profiles use 25 backend examples × up to 30 steps and 100 desktop sequences
× up to 40 commands. Nightly profiles use 200 × 80 and 1000 × 100 respectively.
These are search budgets, not proof that every combination was exercised.
Hypothesis prints minimized steps and a reproduction blob; keep an explicit
regression test for every confirmed defect. fast-check prints seed/path/replayPath;
replay with `FC_SEED`, `FC_PATH`, and `FC_REPLAY_PATH`. The unified runner's `-Seed`
also sets the Hypothesis seed and records it in the report.

## Network chaos and load

The desktop talks to the HTTP test proxy, then Toxiproxy, then the API. Tests
exercise latency, jitter, bandwidth restriction, connection resets, and losing a
reply **after** server commit. Twelve concurrent copies of a heartbeat must create
one event; retries respect HTTP 429 backpressure and never accept a 500 as success.

k6 uses a dedicated temporary company and one distinct device per virtual user.
Quick load is 3 users for 12 seconds; nightly load is 20 users for 90 seconds.
It tests authenticated writes and replay, with zero failed business checks or
unexpected HTTP failures, p95 under 2 seconds and p99 under 5 seconds. HTTP 429 is
bounded/retried as normal backpressure; exhausting retries fails the business check.
Retries honor `Retry-After` with capped exponential backoff and jitter (at most
eight attempts). Backpressure and retry counts remain visible in the metrics.
The logical request latency includes backoff (p95 below 15s, p99 below 60s), in
addition to the per-attempt HTTP thresholds. Up to 120s of graceful stopping lets
already-started iterations finish their replay checks instead of hiding them.
These workloads measure this fixture; they do not establish maximum production capacity.

## Windows native checks

`e2e/native/Test-WindowsTime.ps1` tests actual OS clock/timezone changes using the
real tracking clock in a child observer. It refuses to modify a physical machine.
It requires an administrator in a disposable VM plus `KHALIDUO_NATIVE_TEST_VM=1`
or the GitHub-hosted VM context, and restores the original settings in `finally`.
The hosted Windows quality job runs those clock/timezone checks.

Actual suspend/wake additionally needs `-IncludeSleep`, a VM that supports sleep
and wake timers, and the manually dispatched `native-power.yml` workflow on a
self-hosted runner labelled `khaliduo-power-vm`. It registers a temporary wake task,
enables the shutdown privilege and checks that a >60-second suspended gap earns
no work in the clock/tick observer. It restores time/zone and removes the wake task.
This observer checks OS/clock behavior; full hardware input hooks, the signed
installer and Windows login/shutdown still need the manual Windows checklist.
An unavailable native VM is reported as blocked, never as a passed native test.

Local Electron test windows carry a yellow **TEST ONLY / Local database** badge
and suppress focus/topmost behavior so the employee's installed app can stay in
front. Background test windows also refuse native keyboard/mouse input; Playwright
uses CDP input, so a developer's Enter key cannot answer a test idle alert.
CI sets `E2E_FOREGROUND=1` for actual window activation behavior. The native
input probe is replaced only in unpackaged runs with an explicit isolated test
profile; packaged apps always retain their real probe.
Electron's process-local `TZ` explicitly matches the seeded company timezone,
including on UTC CI hosts; this never changes the developer's Windows settings.

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
| Postgres 16 | Portable Windows cluster or Docker `khaliduo-e2e-postgres`, `127.0.0.1:55432` | fresh disposable data per run |
| Backend | `127.0.0.1:8010` | started with cwd `e2e/.runtime`, so `backend/.env` (production) is never read |
| Desktop proxy | `127.0.0.1:8011` | sits between the app and the backend; tests switch it offline or make it return a fixed status |
| Toxiproxy | API `127.0.0.1:8477`, proxy `127.0.0.1:8012` | loopback-only network fault injection |
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
- **Real hardware input-probe checks, real screenshots, and the tray menu UI.** The real input-monitor logic is covered by behavior/property tests with deterministic reports.
- **Midnight rollover:** covered by backend pytest and desktop timezone/property tests.
