# Windows Testing

Manual Windows validation will include:

1. Install the application.
2. Enroll a device once.
3. Sign out of Windows and sign back in without launching Khaliduo manually.
4. Confirm Khaliduo launches automatically after Windows sign-in, remains hidden instead of opening its main window, and is visible in the system tray.
5. Confirm tracking starts automatically for the enrolled device and the worked-time counter begins increasing only after the new Windows sign-in.
6. Record the worked-time total, pause tracking, wait at least 30 seconds, and confirm neither tracked time nor screenshots increase while paused.
7. Resume tracking and confirm the counter continues from the pre-pause total instead of resetting, then starts increasing again without counting the paused interval.
8. Record the worked-time total, put Windows to sleep for at least two minutes, resume it, and confirm the sleep interval is not added to active or idle work time.
9. Repeat the previous check across a full Windows shutdown and sign-in, confirming the shutdown interval is not counted and a new tracking session starts automatically.
10. Disconnect the network before Windows sign-in and confirm Khaliduo still launches automatically in the system tray and reports an offline state without crashing.
11. Restore the network, wait for the automatic retry, and confirm tracking starts without manually opening Khaliduo or pressing Resume and without creating duplicate active sessions.
12. Confirm lock, unlock, suspend, and resume status transitions are reflected in the desktop app and admin dashboard.
13. Confirm screenshots pause while locked, sleeping, idle when idle capture is disabled, or manually paused.
14. Confirm the admin dashboard shows the employee as online during an active session.
15. Confirm screenshots appear in the admin dashboard and are not visible in the employee app.
16. Create a team from the admin dashboard, add the employee, and verify team filters for screenshots, timesheets, and reports.
