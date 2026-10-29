# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Credential-based first-run enrollment

The desktop app uses the employee's email and password for first-run enrollment.
It authenticates through the employee portal endpoint:

```http
POST /api/v1/employee-auth/login
Content-Type: application/json

{
  "email": "employee@example.com",
  "password": "employee-password"
}
```

After login, the desktop main process immediately exchanges that short-lived
employee access token through the following required backend endpoint:

```http
POST /api/v1/agent/enroll-authenticated
Authorization: Bearer <employee-access-token>
Content-Type: application/json

{
  "device": {
    "installation_id": "stable-installation-uuid",
    "device_name": "WINDOWS-HOSTNAME",
    "operating_system": "Windows 10.0.x",
    "agent_version": "1.1.5",
    "windows_username": "employee"
  }
}
```

That endpoint must authenticate an active employee from the bearer token,
create or update the device for the stable `installation_id`, reject revoked
devices, issue a device token, and return the standard API success envelope:

```json
{
  "success": true,
  "data": {
    "company_id": "uuid",
    "employee": {
      "id": "uuid",
      "name": "Employee name",
      "email": "employee@example.com",
      "timezone": "Europe/London"
    },
    "device": {
      "id": "uuid",
      "name": "WINDOWS-HOSTNAME",
      "installation_id": "stable-installation-uuid",
      "status": "active"
    },
    "device_token": "signed-device-token",
    "token_type": "bearer",
    "settings": {}
  },
  "meta": {}
}
```

For an installation already linked to another employee, the endpoint should
return `409 DEVICE_ALREADY_LINKED`; revoked devices should return `403
DEVICE_REVOKED`. Re-linking the same installation to the same employee should
be idempotent and should revoke older active device tokens before issuing the
replacement. The endpoint should be rate-limited and available only over
HTTPS.

The renderer never receives either access token. The password stays
only in the first-run form and the IPC request and is never written to disk;
the short-lived employee token exists only in the Electron main process during
the exchange. Only the resulting device token is persisted, encrypted with
Electron `safeStorage` (Windows DPAPI).

## Desktop quote reminders

Reminders use two public sources; no API key or `.env` change is needed:

- [ZenQuotes](https://docs.zenquotes.io/zenquotes-documentation/): English batches from `https://zenquotes.io/api/quotes`.
- [Quote Unquote](https://gitlab.com/Assayyaad/quote-unquote): Arabic and English collections from its public GitLab Repository Files API (`data/ar/quotes.json` and `data/en/quotes.json`). The provider's website was unavailable during verification, so the app reads the public JSON files directly through GitLab's API.

The main process fetches up to 50 quotes per collection, shuffles each batch,
and rotates through it before repeating. Each provider/language keeps its own
batch and cursor in the app's user-data directory: `quote-feed.json`,
`quote-unquote-ar.json`, and `quote-unquote-en.json`. Batches refresh when a
reminder is due after one hour. Public quote requests do not use the
employee/device API client or its credentials.

The existing Arabic/English reminder schedule is preserved. Arabic turns prefer
Quote Unquote; English turns alternate between both sources, with the other
English source as a fallback. Every external quote displays its author and a
clickable provider credit. Arabic text and authors retain Tajawal and RTL
direction. The external collections are independent, rather than paired
translations: the Translate action appears only for catalogue quotes with a
known translation.

Each request has a four-second timeout. On a provider/network error, the app uses
its cached batch, the other English provider, or the bundled quote, and waits
five minutes before retrying the failed source. Turning reminders off or signing out cancels display of an in-flight
quote. Settings → Quote notifications controls the interval and enabled state.

```powershell
node --test tests/quoteFeed.test.ts tests/quoteReminderWindow.test.ts
# From ../../e2e after building the desktop app:
npx.cmd playwright test --config desktop-native.config.ts --grep "quote"
```
