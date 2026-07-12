# Lovable Integration

The Lovable dashboard has been merged into `admin-dashboard/` and connects to the FastAPI backend directly. The raw cloned Lovable repository may remain locally in `lovable-dashboard/` as an ignored reference only; it is not part of the active application.

## Base URL

Development:

```text
http://127.0.0.1:8000/api/v1
```

Production example:

```text
https://tracking-api.company-domain.com/api/v1
```

Set dashboard and Lovable origins in `CORS_ORIGINS`, for example:

```env
CORS_ORIGINS=http://localhost:5174,https://your-lovable-app.lovable.app
```

The local admin dashboard runs on:

```text
http://localhost:5174
```

## Response Format

Success:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Readable error message",
    "details": {}
  }
}
```

All timestamps are ISO-8601 UTC.

## Authentication Flow

1. Call `POST /auth/login` with admin email and password.
2. Store `access_token` in memory or secure browser storage.
3. Store `refresh_token` securely.
4. Send `Authorization: Bearer <access_token>` on all dashboard requests.
5. When the access token expires, call `POST /auth/refresh`.
6. On logout, call `POST /auth/logout` with the refresh token.

Roles:

- `general_admin`: company-wide access.
- `team_owner`: access only to teams assigned through `TeamOwner`.

The backend enforces team access. Lovable should still hide inaccessible UI, but it must not rely on frontend filtering for security.

```ts
const login = await fetch(`${API_BASE}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
```

## Dashboard Endpoints

Auth:

```text
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
```

Dashboard:

```text
GET /dashboard/summary
```

Employees:

```text
GET    /employees?team_id=&search=&status=&department=&sort=name&page=1&page_size=25
POST   /employees
GET    /employees/{employee_id}
PATCH  /employees/{employee_id}
DELETE /employees/{employee_id}
GET    /employees/{employee_id}/status
GET    /employees/{employee_id}/sessions?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
GET    /sessions/{session_id}
GET    /sessions/{session_id}/events
```

Teams:

```text
GET    /teams?status=&search=&page=1&page_size=25
POST   /teams
GET    /teams/{team_id}
PATCH  /teams/{team_id}
DELETE /teams/{team_id}

GET    /teams/{team_id}/members
POST   /teams/{team_id}/members
DELETE /teams/{team_id}/members/{employee_id}

GET    /teams/{team_id}/owners
POST   /teams/{team_id}/owners
DELETE /teams/{team_id}/owners/{admin_user_id}

GET /teams/{team_id}/summary
GET /teams/{team_id}/screenshots
GET /teams/{team_id}/sessions
GET /teams/{team_id}/timesheets
GET /teams/{team_id}/reports
```

Team management writes require General Admin access. Team Owners can read only assigned teams.

Screenshots:

```text
GET    /screenshots?team_id=&employee_id=&day=YYYY-MM-DD&session_id=&page=1&page_size=25
GET    /screenshots/{screenshot_id}
GET    /screenshots/{screenshot_id}/file
DELETE /screenshots/{screenshot_id}
```

Screenshot list/detail responses include `temporary_url`. The endpoint requires admin authentication, so browser `<img>` tags cannot call it directly unless the request carries auth. The merged dashboard fetches the file with `Authorization: Bearer <token>`, converts it to a blob URL, then uses that blob URL in the UI:

```tsx
const blob = await apiFile(screenshot.temporary_url);
const src = URL.createObjectURL(blob);
```

Devices:

```text
GET   /devices?team_id=&status=&employee_id=&page=1&page_size=25
GET   /devices/{device_id}
PATCH /devices/{device_id}
POST  /devices/{device_id}/revoke
```

Timesheets:

```text
GET /timesheets/daily?team_id=&day=YYYY-MM-DD
GET /timesheets/weekly?team_id=&week_start=YYYY-MM-DD
GET /timesheets/employee/{employee_id}?team_id=&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
```

Reports:

```text
GET /reports/summary?team_id=
GET /reports/employees?team_id=
GET /reports/export.csv?team_id=
```

Tracking Settings:

```text
GET   /settings/tracking
PATCH /settings/tracking
```

Patch body example:

```json
{
  "screenshot_enabled": true,
  "screenshot_interval_minutes": 10,
  "idle_threshold_minutes": 5,
  "capture_during_idle": false,
  "offline_threshold_minutes": 3,
  "screenshot_retention_days": 90
}
```

## TypeScript Client

```ts
export class KhaliduoApi {
  constructor(
    private readonly baseUrl: string,
    private accessToken: string | null = null,
  ) {}

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  async request<T>(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        ...init.headers,
      },
    });
    const body = await response.json();
    if (!body.success) {
      throw new Error(body.error?.message ?? "API request failed");
    }
    return body.data as T;
  }

  login(email: string, password: string) {
    return this.request<{ access_token: string; refresh_token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  summary() {
    return this.request("/dashboard/summary");
  }

  employees(params = new URLSearchParams()) {
    const query = params.toString();
    return this.request(`/employees${query ? `?${query}` : ""}`);
  }
}
```
