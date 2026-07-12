# Security

Security principles:

- Store JWT and device secrets outside source control.
- Store desktop device tokens using Windows secure storage through Electron.
- Do not log passwords, tokens, authorization headers, or screenshot binary data.
- Scope every admin request to the authenticated company.
- Validate screenshot MIME type, size, checksum, and ownership.
- Keep screenshot URLs private and temporary.
