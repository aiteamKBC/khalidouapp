# Privacy

Khaliduo is a transparent employee tracking application used with employee knowledge and approval.

It records working time, online status, idle status, foreground application names,
supported-browser website domains, and periodic screenshots during work sessions.

Website tracking is intentionally limited to the domain (for example,
`example.com`). Full URLs, paths, query strings, and browser page titles are not
sent to the server.

It does not record typed text, passwords, webcam, microphone, clipboard,
personal files, or browser passwords.

The server uses the device's public IP address to determine its country-level
timezone for shift calculations. The effective timezone and two-letter country
code are stored with the enrolled device; precise GPS coordinates are not
requested or stored. The desktop also reports the Windows IANA timezone as a
fallback when country lookup is unavailable.
