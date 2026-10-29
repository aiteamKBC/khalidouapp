// Test-only native host: real renderer, preload, IPC, tracking functions and
// policy modules. OS input, backend replies and installers are controlled seams.
// This file is outside electron/ and is never included in the packaged app.
import electron from 'electron/main';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import crypto from 'node:crypto';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const literal = (file, name) => {
  const ast = ts.createSourceFile(file, fs.readFileSync(path.join(desktop, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of ast.statements) if (ts.isVariableStatement(statement)) for (const node of statement.declarationList.declarations) if (node.name.getText(ast) === name) return Function(`return (${node.initializer.getText(ast)})`)();
  throw new Error(`Missing fixture source ${name}`);
};
const task = (id, name, projectId = 'project-a', teamId = 'team-a') => ({ id, name, projectId, teamId, projectName: projectId === 'project-a' ? 'Client delivery' : 'Internal tools', teamName: teamId === 'team-a' ? 'Delivery team' : 'Platform team', description: 'Deliver the agreed work.', stage: 'assigned', canUpdateStage: true, reviewNote: null, completionNote: null, checklist: [], activeSeconds: 0, idleSeconds: 0, trackedSeconds: 0 });

export async function boot(profile) {
  const { app, BrowserWindow, ipcMain, screen } = electron;
  app.setPath('userData', profile);
  await app.whenReady();
  const helper = await import(pathToFileURL(path.join(desktop, '.tmp/runner/mainHarness.mjs')).href);
  const start = Date.parse('2026-10-27T09:00:00Z');
  let now = start, idleSince = null, lastInput = start, monitor;
  const calls = [], events = [], queued = [], delivered = [], errors = [];
  const failures = new Map();
  let online = true, scheduled = false, shots = [], reschedules = [], pendingStart = null, quoteReply = null;
  const bilingualQuoteReply = { ar: null, en: null };
  const base = literal('src/App.tsx', 'fallbackStatus');
  const status = { ...base, enrolled: true, appearanceScope: null, employeeName: 'Desktop E2E', employeeEmail: 'desktop@e2e.example.test', deviceId: 'desktop-e2e', deviceName: 'Isolated test device', trackingStatus: 'active', trackingPaused: false, connectionStatus: 'online', sessionStartedAt: new Date(start).toISOString(), screenshotMonitoringEnabled: true, screenshotCaptureActive: true, powerSource: 'ac', agentVersion: 'e2e',
    requestPolicy: { timezone: 'Africa/Cairo', shift_start: '09:00', shift_end: '17:00', working_days: [0,1,2,3,4,5,6], weekly_early_leave_minutes: 120, weekly_early_leave_used_minutes: 0, weekly_early_leave_remaining_minutes: 120 },
    leaveRequests: { balance: { year: 2026, credit_days: 21, used_days: 5, remaining_days: 16 }, requests: [] },
    projects: [{ id: 'project-a', name: 'Client delivery', team_id: 'team-a', team_name: 'Delivery team' }, { id: 'project-b', name: 'Internal tools', team_id: 'team-b', team_name: 'Platform team' }],
    tasks: [task('task-a', 'Prepare client delivery'), task('task-b', 'Improve internal tools', 'project-b', 'team-b')],
  };
  let main;
  const send = (channel, payload) => { const window = main ?? c?.mainWindow; if (window && !window.isDestroyed()) window.webContents.send(channel, payload); };
  let c;
  const publish = () => {
    status.currentIdleSeconds = c?.runtimeStatus.trackingStatus === 'idle' && c.idleWallClockStartedAt != null && !scheduled && !c.savedBreakCover ? Math.max(0, Math.floor((now - c.idleWallClockStartedAt) / 1000)) : 0;
    status.screenshotCaptureActive = c ? !c.screenshotCaptureBlockReason() : true;
    if (c) Object.assign(status, c.runtimeStatus);
    send('agent:status-changed', status);
  };
  const stop = async reason => {
    c.recalculateWorkedTime({ finalCheckpoint: true });
    events.push({ event: 'session_ended', reason, at: now });
    c.trackingPausedByUser = true; c.unpaidPauseActive = false; c.currentSessionId = null;
    status.trackingPaused = true; status.trackingStatus = 'paused'; status.sessionStartedAt = null;
    c.clearTimedBreak(); c.saveTrackingPreferences(); publish();
    return { success: true };
  };
  c = helper.context({ runtimeStatus: status, currentSessionId: 'session-e2e', activeCounterDate: '2026-10-27', lastDurationTickAt: start,
    eligibleIdleSecondsBeforeCurrentIdle: 0, idleWallClockStartedAt: null, idleTimer: null, idleResumedAt: null,
    idleReturnVerification: null, lastHandledIdleReturnInputAt: start, automaticIdleStartPromise: null, automaticIdleFinishPromise: null, isFinishingAutomaticIdle: false, savedBreakCover: null, activeMeeting: null,
    LONG_IDLE_SESSION_SPLIT_SECONDS: 14400,
    app: { getPath: () => profile, quit: () => calls.push({ method: 'app:quit' }) }, mainWindow: null,
    BrowserWindow, screen, __dirname: path.join(desktop, 'dist-electron-khaliduo'), getAppIconPath: () => undefined,
    idleAlertAttentionActive: false, updateAttentionActive: false, idleAttentionTimer: null,
    trackingConfig: { idle_threshold_minutes: 15, screenshot_enabled: true, capture_during_idle: false },
    setInterval: callback => { monitor = callback; return 1; },
    powerMonitor: { getSystemIdleTime: () => idleSince == null ? 0 : Math.floor((now - idleSince) / 1000) },
    observedIdleSeconds: () => idleSince == null ? 0 : Math.max(0, Math.floor((now - idleSince) / 1000)),
    inputIntegrityMonitor: { latestRealInputAt: () => lastInput, confirmPresence: () => { lastInput = now; idleSince = null; } },
    hasTrackingSession: () => Boolean(c.currentSessionId),
    notifyRendererStatus: publish, showMainWindow: () => { main.show(); },
    setIdleAlertAttention: active => { if (!active) status.lastIdleAlert = null; },
    isInsideScheduledBreak: () => scheduled,
    scheduledIdleIsCountable: () => !scheduled && !c.savedBreakCover,
    activeTimeBucket: () => 'normal', meetingRecords: new Map(),
    todaysBreakWindows: () => [], showIdleStartedNotification: () => calls.push({ method: 'scheduled-break-notification' }), showSavedBreakNotification: () => calls.push({ method: 'saved-break-notification' }),
    showIdleLossAlert: (lostSeconds, eligibleLostSeconds) => { status.lastIdleAlert = { id: crypto.randomUUID(), kind: 'idle_return', lostSeconds, eligibleLostSeconds, outsideScheduledShift: scheduled, endedAt: new Date(now).toISOString() }; send('agent:idle-alert', status.lastIdleAlert); },
    invalidateInFlightScreenshotCaptures: () => {},
    sendStateEvent: async (event, nextStatus, data = {}) => {
      status.trackingStatus = nextStatus;
      const row = { id: crypto.randomUUID(), event, data, at: now };
      events.push(row); if (online) delivered.push(row); else queued.push(row);
      if (event === 'idle_ended' && data.idle_gap_seconds >= 60) status.idleRequestPeriods.push({ work_session_id: 'session-e2e', started_at: data.idle_started_at, ended_at: new Date(now).toISOString(), duration_seconds: data.idle_gap_seconds, available_seconds: data.idle_gap_seconds, project_name: null, task_name: null });
      publish(); return online;
    },
    dispatchManualPauseTransition: async (event, nextStatus) => c.sendStateEvent(event, nextStatus),
    stopTrackingSession: stop,
    startTrackingAutomatically: async () => { c.currentSessionId = 'session-' + now; status.sessionStartedAt = new Date(now).toISOString(); status.trackingStatus = 'active'; status.trackingPaused = false; c.lastDurationTickAt = now; publish(); },
    clearPaidPauseTimer: () => {}, beginLocalTrackingSession: () => { c.currentSessionId ??= 'session-' + now; status.sessionStartedAt ??= new Date(now).toISOString(); },
    isMainWindowExpanded: () => main.isMaximized(),
    windowCloseRequest: null, isHandlingWindowClose: false,
    log: { info() {}, warn() {}, error: (...args) => errors.push(args.map(String).join(' ')) },
  });
  c.setClock(now);
  for (const file of ['idlePolicy', 'trackingTick', 'powerTransitionPolicy', 'meetingStore']) Object.assign(c, await import(pathToFileURL(path.join(desktop, 'dist-electron-khaliduo/services/' + file + '.js')).href));
  const functions = ['recalculateWorkedTime', 'startIdleMonitor', 'clearIdleReturnVerification', 'immediateIdleReturnInputDetected', 'automaticIdleDurationSnapshot', 'creditVerifiedReturnPeriod', 'showIdleStartedReview', 'showAutomaticIdleReturnReview', 'finishAutomaticIdleAfterVerification', 'resumeAutomaticIdle', 'savedBreakSecondsLeft', 'pauseTracking', 'resumeTracking', 'clearTimedBreak', 'pauseTimedBreak', 'endExpiredBreak', 'getTrackingPreferencesPath', 'saveTrackingPreferences', 'loadTrackingPreferences', 'screenshotCaptureBlockReason', 'isMainWindowExpanded', 'clearWindowClosePrompt', 'handleWindowCloseChoice', 'createMainWindow', 'showMainWindow', 'maybeAutoEndMeeting'];
  helper.functions(c, ...functions);
  c.startIdleMonitor();

  const register = (method, callback) => ipcMain.handle(method, async (event, ...args) => {
    calls.push({ method, args });
    if (failures.has(method)) return { success: false, message: failures.get(method) };
    const result = await callback(...args, event);
    publish(); return result;
  });
  register('agent:get-status', () => { publish(); return status; });
  register('agent:pause-tracking', options => c.pauseTracking(options));
  register('agent:resume-tracking', () => c.resumeTracking());
  register('agent:resume-automatic-idle', () => c.resumeAutomaticIdle());
  register('agent:end-shift', () => stop('Employee ended shift'));
  register('agent:confirm-tracking-start', async () => { pendingStart = null; c.trackingPausedByUser = false; status.lastIdleAlert = null; return c.startTrackingAutomatically().then(() => ({ success: true })); });
  register('agent:decline-tracking-start', () => { pendingStart = null; status.lastIdleAlert = null; return { success: true }; });
  register('agent:logout', async () => { await stop('Sign out'); status.enrolled = false; status.employeeName = ''; status.employeeEmail = null; status.tasks = []; status.selectedTask = null; status.screenshotMonitoringEnabled = false; return { success: true }; });
  register('agent:enroll-with-credentials', (email, password) => { if (password !== 'E2e-password-1') return { success: false, message: 'Invalid email or password.' }; status.enrolled = true; status.employeeEmail = email; status.employeeName = 'Desktop E2E'; return { success: true }; });
  register('agent:sync-now', () => { if (online) delivered.push(...queued.splice(0)); status.connectionStatus = online ? 'online' : 'offline'; return { success: true }; });
  register('agent:get-recent-screenshots', () => ({ success: true, screenshots: status.screenshotMonitoringEnabled ? shots : [] }));
  register('agent:open-employee-dashboard', section => ({ success: true, section }));
  register('agent:get-appearance', () => null);
  register('agent:set-appearance', (_scope, patch) => ({ success: true, ...patch }));
  register('agent:set-current-task', id => { status.selectedTask = status.tasks.find(task => task.id === id) ?? null; return { success: true, status }; });
  register('agent:create-task', input => { status.tasks.push({ ...task(crypto.randomUUID(), input.name, input.projectId), description: input.description, stage: 'new_requests', canUpdateStage: false }); return { success: true, status }; });
  register('agent:update-task-stage', (id, stage, note) => { const task = status.tasks.find(task => task.id === id); Object.assign(task, { stage, completionNote: note }); return { success: true, status }; });
  register('agent:create-task-checklist-item', (id, title) => { status.tasks.find(task => task.id === id).checklist.push({ id: crypto.randomUUID(), title, completed: false }); return { success: true, status }; });
  register('agent:update-task-checklist-item', (id, itemId, completed) => { status.tasks.find(task => task.id === id).checklist.find(item => item.id === itemId).completed = completed; return { success: true, status }; });
  register('agent:delete-task-checklist-items', (id, ids) => { const task = status.tasks.find(task => task.id === id); task.checklist = task.checklist.filter(item => !ids.includes(item.id)); return { success: true, status }; });
  register('agent:create-time-adjustment-request', input => { status.timeAdjustmentRequests.push({ id: crypto.randomUUID(), request_type: input.requestType ?? 'idle_time', requested_date: input.requestedDate ?? '2026-10-27', requested_minutes: input.requestedMinutes, reason: input.reason, status: 'pending', created_at: new Date(now).toISOString() }); return { success: true, status }; });
  register('agent:create-leave-request', input => { status.leaveRequests.requests.push({ id: crypto.randomUUID(), start_date: input.startDate, end_date: input.endDate, reason: input.reason, leave_type: input.leaveType ?? 'annual', requested_days: 1, status: 'pending', created_at: new Date(now).toISOString() }); return { success: true, status }; });
  const reschedulePolicy = { timezone: 'Africa/Cairo', notice_days: 2, earliest_date: '2026-10-29', working_days: [0,1,2,3,4,5,6], weekly_off_days: [] };
  register('agent:list-shift-reschedules', () => ({ success: true, data: { policy: reschedulePolicy, requests: reschedules } }));
  register('agent:get-shift-reschedule-day', date => ({ success: true, data: { date, scheduled_day: true, shift_start: '09:00', shift_end: '17:00', shift_minutes: 480 } }));
  register('agent:create-shift-reschedule', input => { reschedules.push({ id: crypto.randomUUID(), work_date: input.workDate, requested_start: input.requestedStart, requested_end: input.requestedEnd, original_start: '09:00', original_end: '17:00', status: 'pending', reason: input.reason, source: 'employee' }); return { success: true }; });
  register('agent:cancel-shift-reschedule', id => { reschedules.find(row => row.id === id).status = 'cancelled'; return { success: true }; });
  register('agent:start-meeting', input => { status.activeMeeting = { ...input, startedAt: new Date(now).toISOString(), expectedEndAt: new Date(now + input.expectedEndMinutes * 60000).toISOString(), endedAt: null, idempotencyKey: crypto.randomUUID(), syncState: online ? 'start_synced' : 'start_pending', lastError: null }; c.activeMeeting = status.activeMeeting; c.meetingRecords.set(status.activeMeeting.idempotencyKey, status.activeMeeting); return { success: true }; });
  c.endMeeting = () => { const active = status.activeMeeting; if (!active) return { success: true }; const ended = { ...active, id: active.idempotencyKey, lifecycleState: 'ended', endedAt: new Date(now).toISOString(), status: 'pending', recordedSeconds: Math.floor((now - Date.parse(active.startedAt)) / 1000), syncState: online ? null : 'end_pending' }; status.meetings.unshift(ended); c.meetingRecords.set(active.idempotencyKey, ended); status.activeMeeting = c.activeMeeting = null; publish(); return { success: true }; };
  register('agent:end-meeting', c.endMeeting);
  register('agent:refresh-meetings', () => status.meetings);
  register('agent:retry-meeting-sync', () => { for (const row of status.meetings) row.syncState = null; return { success: true }; });
  register('agent:check-for-updates', () => ({ success: true }));
  register('agent:install-update', () => ({ success: true }));
  ipcMain.on('agent:set-idle-alert-attention', (_event, active) => { if (!active) status.lastIdleAlert = null; });
  ipcMain.on('agent:set-update-attention', () => {});
  register('window:minimize', () => main.minimize());
  register('window:toggle-maximize', () => main.isMaximized() ? main.unmaximize() : main.maximize());
  register('window:is-expanded', () => c.isMainWindowExpanded());
  const { QuoteReminderWindow } = await import(pathToFileURL(path.join(desktop, 'dist-electron-khaliduo/services/quoteReminderWindow.js')).href);
  const { QuoteFeed, QuoteSources } = await import(pathToFileURL(path.join(desktop, 'dist-electron-khaliduo/services/quoteFeed.js')).href);
  const feedOptions = { now: () => now, random: () => 0.999, fetch: async url => { calls.push({ method: 'quote:http', url }); const reply = url.includes('zenquotes.io') ? quoteReply : bilingualQuoteReply[url.includes('%2Far%2F') ? 'ar' : 'en']; if (!reply) throw new Error('Fixture offline'); return new Response(JSON.stringify(reply)); } };
  const sources = new QuoteSources({ zenquotes: new QuoteFeed(feedOptions), arabic: new QuoteFeed({ ...feedOptions, provider: 'quote-unquote', language: 'ar' }), english: new QuoteFeed({ ...feedOptions, provider: 'quote-unquote', language: 'en' }) });
  const quotes = new QuoteReminderWindow({ resolveQuote: (language, sequence) => sources.next(language, sequence), createWindow: options => new BrowserWindow(options), preload: path.join(desktop, 'dist-electron-khaliduo/preload.js'), getWorkArea: () => screen.getDisplayMatching(main.getBounds()).workArea, loadWindow: window => window.loadFile(path.join(desktop, 'dist-khaliduo/index.html'), { query: { window: 'quote' } }) });
  register('quote:show', payload => quotes.show(payload));
  ipcMain.handle('quote:get', event => quotes.getPayload(event.sender));
  ipcMain.handle('quote:open-source', event => { if (quotes.owns(event.sender)) calls.push({ method: 'quote:open-source' }); });
  ipcMain.handle('quote:dismiss', () => quotes.dismiss());
  ipcMain.on('quote:resize', (event, height) => quotes.resize(event.sender, height));
  register('window:get-close-request', () => c.windowCloseRequest);
  register('window:close', () => main.close());
  register('window:respond-close', (id, choice) => c.handleWindowCloseChoice(id, choice));

  const snapshot = () => ({ status, calls: calls.filter(row => row.method !== 'agent:get-status'), events, queued, delivered, errors, screenshotBlockReason: c.screenshotCaptureBlockReason(), now });
  globalThis.desktopTest = { cleanup: () => { c.isQuitting = true; quotes.dispose(); }, control: async (command, value) => {
    if (command === 'inspect') return snapshot();
    if (command === 'fail') failures.set(value.method, value.message ?? 'Fixture service unavailable. Please retry.');
    else if (command === 'recover') failures.delete(value);
    else if (command === 'patch') Object.assign(status, value);
    else if (command === 'network') { online = value; status.connectionStatus = online ? 'online' : 'offline'; }
    else if (command === 'scheduled') scheduled = value;
    else if (command === 'idle') idleSince = value == null ? null : now - value * 1000;
    else if (command === 'power') { c.recalculateWorkedTime(); c.screenLocked = value === 'locked'; c.systemSleeping = value === 'sleeping'; status.trackingStatus = value === 'active' && !c.unpaidPauseActive ? 'active' : value; }
    else if (command === 'battery') { c.onAcPower = !value; status.powerSource = value ? 'battery' : 'ac'; }
    else if (command === 'show') main.show();
    else if (command === 'size') main.setSize(value.width, value.height);
    else if (command === 'screenshots') shots = value;
    else if (command === 'quote-feed') quoteReply = value;
    else if (command === 'quote-feed-extra') bilingualQuoteReply[value.language] = value.rows;
    else if (command === 'restore-break') { c.loadTrackingPreferences(); c.lastDurationTickAt = now; }
    else if (command === 'start-prompt') { await stop('Before starting'); pendingStart = { id: crypto.randomUUID(), kind: 'tracking_start', lostSeconds: 0, eligibleLostSeconds: 0, outsideScheduledShift: Boolean(value), endedAt: new Date(now).toISOString() }; status.lastIdleAlert = pendingStart; send('agent:idle-alert', pendingStart); }
    else if (command === 'advance') {
      if (value.idle && idleSince == null) idleSince = now;
      if (!value.idle) { idleSince = null; lastInput = now + value.seconds * 1000; }
      for (let index = 0; index < value.seconds; index++) {
        now += 1000; c.setClock(now); c.recalculateWorkedTime(); monitor(); await Promise.resolve(); await c.endExpiredBreak();
      }
    }
    else throw new Error('Unknown native control: ' + command);
    publish(); return snapshot();
  } };
  await c.createMainWindow();
  main = c.mainWindow;
  main.setSize(1200, 900);
  c.showMainWindow();
}
