# Khaliduo end-to-end tests

Automated tests that run the **backend, the website and the Electron desktop app together**, against a throwaway local Postgres. Nothing here can reach production: every URL is checked by `assertIsolated()` before a process starts.

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
