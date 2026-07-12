# Production VPS deployment

The production Compose stack runs PostgreSQL, FastAPI, the Admin Dashboard, and Nginx. PostgreSQL is private to the Docker network; screenshots and database data use persistent Docker volumes.

## 1. DNS

Create two `A` records pointing to the VPS public IP:

```text
api.khaliduo.example.com -> VPS_PUBLIC_IP
app.khaliduo.example.com -> VPS_PUBLIC_IP
```

## 2. Production environment

Create `backend/.env` on the VPS. Never commit this file:

```env
APP_ENV=production
APP_NAME=Khaliduo
DATABASE_URL=postgresql://employee_tracker:CHANGE_ME@postgres:5432/employee_tracker
JWT_SECRET_KEY=CHANGE_ME_LONG_RANDOM_VALUE
DEVICE_TOKEN_SECRET=CHANGE_ME_DIFFERENT_LONG_RANDOM_VALUE
CORS_ORIGINS=https://app.khaliduo.example.com
SCREENSHOT_STORAGE_TYPE=local
SCREENSHOT_STORAGE_PATH=/app/storage/screenshots
DESKTOP_INSTALLER_PATH=/app/downloads/KhaliduoSetup.exe
DESKTOP_UPDATE_DIRECTORY=/app/downloads
SCREENSHOT_MAX_FILE_SIZE_MB=10
APP_PUBLIC_URL=https://app.khaliduo.example.com
PASSWORD_RESET_EXPIRE_MINUTES=30

# Configure Microsoft Graph (preferred) or SMTP so invitations and resets send.
GRAPH_TENANT_ID=
GRAPH_CLIENT_ID=
GRAPH_CLIENT_SECRET=
GRAPH_SENDER=no-reply@your-domain.com
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=Khaliduo <no-reply@your-domain.com>
SMTP_USE_TLS=true
```

Add the Docker Compose and public routing values to the same protected `backend/.env` file:

```env
POSTGRES_DB=employee_tracker
POSTGRES_USER=employee_tracker
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD
API_DOMAIN=api.khaliduo.example.com
DASHBOARD_DOMAIN=app.khaliduo.example.com
PUBLIC_API_BASE_URL=https://api.khaliduo.example.com/api/v1
PUBLIC_DESKTOP_DOWNLOAD_URL=https://api.khaliduo.example.com/api/v1/downloads/windows
```

The commands below explicitly load this file for both Compose interpolation and the backend container.

## 3. HTTPS certificates

The first certificates must exist before the HTTPS Nginx container starts. With ports 80 and 443 free:

```bash
docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot certonly --standalone -d api.khaliduo.example.com
docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot certonly --standalone -d app.khaliduo.example.com
```

Renew through the shared webroot, then reload Nginx after a successful renewal:

```bash
docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v "$PWD/deployment/certbot-webroot:/var/www/certbot" \
  certbot/certbot renew --webroot -w /var/www/certbot
docker compose --env-file .env -f docker-compose.prod.yml exec nginx nginx -s reload
```

Schedule these commands with cron or a systemd timer.

## 4. Build the Windows release

Increase the version in `frontend/desktop-agent/package.json`. Build on the trusted Windows signing machine:

```powershell
$env:VITE_API_BASE_URL="https://api.khaliduo.example.com/api/v1"
$env:KHALIDUO_EMPLOYEE_PORTAL_URL="https://app.khaliduo.example.com/employee"
$env:KHALIDUO_UPDATE_URL="https://api.khaliduo.example.com/api/v1/updates/windows"
$env:UPDATE_CHECK_INTERVAL_MINUTES="15"
npm run build:installer
```

Upload these three files together to `frontend/desktop-agent/release-khaliduo/` on the VPS:

- `KhaliduoSetup.exe`
- `KhaliduoSetup.exe.blockmap`
- `latest.yml`

The installer embeds the production API and portal URLs. An enrolled installation starts silently with Windows. When a higher version is published, the app downloads it, shows a required-update message, safely closes active tracking, installs it, and restarts automatically.

## 5. Start or update the stack

From `backend/`:

```bash
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
docker compose --env-file .env -f docker-compose.prod.yml exec backend-api alembic current
```

The backend container runs `alembic upgrade head` before starting Uvicorn. The second command verifies the active migration revision.

## 6. Smoke tests

Verify all of the following after deployment:

- `https://api.khaliduo.example.com/api/v1/health`
- Admin login and role restrictions.
- Employee/Team Manager invitation email.
- Password-reset link opens the production dashboard.
- Device enrollment with a one-time code.
- Khaliduo starts hidden after the next Windows login.
- Screenshot upload and protected image display.
- Installer download from `/download`.
- Publish a higher desktop version and verify the required update installs and restarts.

## Backups

PostgreSQL:

```bash
docker compose --env-file .env -f docker-compose.prod.yml exec postgres pg_dump -U employee_tracker employee_tracker > backup.sql
```

Screenshots:

```bash
docker run --rm -v khaliduo_screenshots:/data -v "$PWD:/backup" alpine tar czf /backup/screenshots.tar.gz /data
```

Back up both regularly. Nginx allows 20 MB uploads; keep this above `SCREENSHOT_MAX_FILE_SIZE_MB`.
