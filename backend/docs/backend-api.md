# Backend API

The backend is a FastAPI application exposing `/api/v1` endpoints for the desktop agent and the Lovable dashboard.

OpenAPI is available at:

```text
http://localhost:8000/docs
http://localhost:8000/openapi.json
```

Team-based authorization is enforced server-side:

- General Admins (`general_admin`) can access all company records.
- Team Owners (`team_owner`) can access only employees and tracking data connected to their assigned teams.
- Any `team_id` query parameter is validated against the authenticated admin before filtering data.

Device enrollment uses the employee's email and password. After employee authentication,
`POST /api/v1/agent/enroll-authenticated` links the current installation and returns a
device token. The desktop app encrypts that token using Windows DPAPI; passwords and
employee access tokens are never persisted by the app.

All JSON responses use:

```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

Errors use:

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
