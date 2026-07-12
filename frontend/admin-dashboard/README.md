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
