# Khaliduo Admin Dashboard

Lovable dashboard merged into the local Khaliduo project and wired to the FastAPI backend.

The employee portal at `/employee` uses the **Khaliduo Employee Dashboard** Readdy
design (project `daf9820f-f19f-4eeb-98d5-07878050b82c`, preview version `15222173`).
Its components live in `src/components/employee-workspace` and use the existing
employee APIs for authentication, tasks, time and leave requests, profile updates,
notifications, and protected screenshots. Desktop handoff and screenshot deletion
with tracked-time deduction remain available. The Electron application is separate.
Run `npm run test:employee-workspace` to check time counting and workflow mappings.

## Development

```powershell
Set-Location frontend/admin-dashboard
npm install
npm run dev -- --host localhost --port 5174
```

Default API URL:

The backend must run separately. For missing `SALARY_ENCRYPTION_KEY` or salary-related
API errors, follow [the local environment fix](../../docs/web-local-environment-fix.md).
From `backend/`, `npm run check:env` checks configuration without accessing the database.

```text
http://127.0.0.1:8000/api/v1
```

Override it with:

```text
VITE_API_BASE_URL=https://your-api-domain.com/api/v1
```

## Hostinger deployment

Deploy this directory as a server-side Node application with these settings:

```text
Root directory: frontend/admin-dashboard
Node.js version: 22
Build command: npm run build
Output directory: .output
Start command: npm start
Port: 3000
```

Set both public URLs before building because Vite embeds them in the client bundle:

```text
VITE_API_BASE_URL=https://api.khaliduoapp.kentbusinesscollege.net/api/v1
VITE_DESKTOP_DOWNLOAD_URL=https://api.khaliduoapp.kentbusinesscollege.net/api/v1/downloads/windows
```

The production build targets Nitro's persistent Node server. Hostinger must run
`.output/server/index.mjs`; a Cloudflare-targeted bundle exits without opening the
HTTP port and leaves LiteSpeed returning `503 Service Unavailable`.
