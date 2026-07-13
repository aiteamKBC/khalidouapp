# Khaliduo Admin Dashboard

Lovable dashboard merged into the local Khaliduo project and wired to the FastAPI backend.

## Development

```powershell
Set-Location frontend/admin-dashboard
npm install
npm run dev -- --host localhost --port 5174
```

Default API URL:

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
