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
