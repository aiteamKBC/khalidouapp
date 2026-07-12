# Troubleshooting

Common checks:

- Confirm `VITE_API_BASE_URL` points to the backend `/api/v1` URL.
- Confirm backend `/api/v1/health` returns success.
- Confirm `CORS_ORIGINS` contains the Lovable dashboard URL.
- Confirm screenshot storage path exists and is writable by the backend process.
- Confirm the device has internet access before enrollment.
