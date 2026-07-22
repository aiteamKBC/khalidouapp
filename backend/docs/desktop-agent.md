# Desktop Agent

The desktop agent is an Electron, React, TypeScript, Vite application for Windows 10 and Windows 11.

It is transparent to employees, displays a system tray icon, and shows a privacy notice in the status window.

Enrollment flow:

1. A General Admin creates the employee in the admin dashboard.
2. The employee accepts the email invitation and chooses a password.
3. The employee installs Khaliduo and signs in with the same email and password.
4. The backend authenticates the employee, links the installation to that account, and issues an encrypted device token.

Each installation has a stable identifier. A device cannot be silently reassigned to another employee, and revoked devices cannot enroll again without administrator action.

Daily operation after enrollment:

1. Windows login starts Khaliduo automatically.
2. The agent authenticates using saved device credentials.
3. The agent starts or resumes the current work session.
4. Heartbeats, activity events, and screenshots sync to the backend.

Screenshot cadence is controlled by the company tracking settings. With the default settings, Khaliduo captures two screenshots at random times inside each 10-minute interval.
