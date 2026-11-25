# Deployment

Production target: Hostinger VPS.

Services:

- FastAPI backend
- PostgreSQL
- Nginx HTTPS reverse proxy
- Private local screenshot storage

Production API URL example:

```text
https://tracking-api.company-domain.com/api/v1
```

## Steps

1. Point DNS `tracking-api.company-domain.com` to the VPS IP.
2. Install Docker and Docker Compose.
3. Create `backend-api/.env` with production secrets.
4. Create root `.env` with PostgreSQL credentials.
5. Start containers:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

6. Run migrations:

```bash
docker compose -f docker-compose.prod.yml exec backend-api alembic upgrade head
```

7. Configure HTTPS with Let's Encrypt.
8. Add Lovable URL to `CORS_ORIGINS`.
9. Back up PostgreSQL and screenshot storage.

Do not expose PostgreSQL publicly.

## GitHub Actions on the existing VPS

Run **Deploy production API and dashboard** from the repository's Actions tab,
selecting `main`. The workflow uses the existing procedure in
`frontend/scripts/deploy-production.ps1`, including database backup, schema
checks, staged dashboard output, service recovery, and the production audit.
It verifies the public health endpoints and authenticated closed-recovery route
after deployment. A queued run stops if its selected commit is no longer the
tip of `main`.

Repository secrets `KHALIDUO_SSH_PRIVATE_KEY` and `KHALIDUO_SSH_KNOWN_HOSTS`
provide the deployment identity and pinned VPS host key. Install the matching
public deployment key in the VPS root user's `authorized_keys` once, through
the hosting console. Private keys must remain outside Git and chat messages.

This workflow deploys the API and dashboard. Desktop publication remains a
separate step requiring a newly versioned, signed installer and the live
verification required by `time-ledger-constitution.md`.
