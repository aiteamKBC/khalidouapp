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

Device enrollment is admin-controlled:

- `GET /api/v1/employees/{employee_id}/enrollment-codes`
- `POST /api/v1/employees/{employee_id}/enrollment-codes`
- `DELETE /api/v1/employees/{employee_id}/enrollment-codes/{code_id}`

Only General Admins can create or revoke enrollment codes. Codes are single-use; the raw code is returned only by the create endpoint and only at creation time.

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
