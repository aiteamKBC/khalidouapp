# Desktop Agent

The desktop agent is an Electron, React, TypeScript, Vite application for Windows 10 and Windows 11.

It is transparent to employees, displays a system tray icon, and shows a privacy notice in the status window.

Enrollment flow:

1. A General Admin creates the employee in the admin dashboard.
2. The General Admin opens the employee details page and generates a device enrollment code.
3. The code is shared with that employee and shown only once in the dashboard.
4. The employee installs Khaliduo on the laptop and enters the enrollment code.
5. The backend links that device to the employee, marks the code as used, and issues a saved device token.

Generate a new code for every new laptop or reinstall. Codes are single-use and expire.

Daily operation after enrollment:

1. Windows login starts Khaliduo automatically.
2. The agent authenticates using saved device credentials.
3. The agent starts or resumes the current work session.
4. Heartbeats, activity events, and screenshots sync to the backend.

Screenshot cadence is controlled by the company tracking settings. With the default settings, Khaliduo captures two screenshots at random times inside each 10-minute interval.
