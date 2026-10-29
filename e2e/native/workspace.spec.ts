import { test, expect } from './fixture.ts';

test('task requests filter projects by team and submit the entered details', async ({ desktop: d }) => {
  await d.nav('Tasks');
  const form = d.page.locator('.wp-task-request');
  await expect(form.getByRole('button', { name: 'Submit request' })).toBeDisabled();
  await expect(form.getByLabel('Project', { exact: true })).toBeDisabled();
  await form.getByLabel('Task name').fill('Prepare release checklist');
  await form.getByLabel('Description').fill('Document release validation and ownership.');
  await form.getByLabel('Team', { exact: true }).selectOption('team-a');
  await expect(form.getByLabel('Project', { exact: true }).locator('option')).toHaveText(['Select project', 'Client delivery']);
  await form.getByLabel('Project', { exact: true }).selectOption('project-a');
  await form.getByLabel('Start date').fill('2026-10-28');
  await form.getByLabel('Deadline').fill('2026-10-30');
  await form.getByRole('button', { name: 'Submit request' }).click();
  await expect(form.getByLabel('Task name')).toHaveValue('');
  const request = (await d.control('inspect')).calls.find((row: any) => row.method === 'agent:create-task').args[0];
  expect(request).toMatchObject({ name: 'Prepare release checklist', projectId: 'project-a', description: 'Document release validation and ownership.' });
  expect((await d.status()).tasks.at(-1).stage).toBe('new_requests');
});

test('select task, change stage, manage checklist, and submit completed work', async ({ desktop: d }) => {
  await d.nav('Tasks');
  await d.page.getByLabel('Task', { exact: true }).selectOption('task-a');
  await d.page.getByLabel('Stage', { exact: true }).selectOption('in_progress');
  await expect(d.page.locator('.k-task-stage-pill')).toHaveText('in progress');
  await d.page.getByPlaceholder('Add a checklist step...').fill('Review delivery');
  await d.page.locator('.k-checklist-add').getByRole('button', { name: 'Add', exact: true }).click();
  // The controlled checkbox waits for its IPC reply before committing state.
  const completed = d.page.getByRole('checkbox', { name: 'Review delivery' });
  await completed.click();
  await expect(completed).toBeChecked();
  await expect(d.page.locator('.k-checklist-box')).toContainText('1/1 complete');
  await d.page.locator('.k-checklist-item').getByRole('button', { name: 'Select', exact: true }).click();
  await d.page.getByRole('button', { name: 'Delete selected (1)', exact: true }).click();
  await d.page.locator('.swal2-popup').getByRole('button', { name: /Delete selected/i }).click();
  await expect(d.page.getByRole('checkbox', { name: 'Review delivery' })).toHaveCount(0);
  await d.page.getByLabel('What did you do?').fill('Delivered the reviewed client package.');
  await d.page.getByRole('button', { name: 'Complete / submit work', exact: true }).click();
  await expect(d.page.locator('.k-task-stage-pill')).toHaveText('ready for review');
  expect((await d.status()).selectedTask.completionNote).toBe('Delivered the reviewed client package.');
});

test('failed task creation retains the draft and supports retry', async ({ desktop: d }) => {
  await d.nav('Tasks');
  await d.control('fail', { method: 'agent:create-task', message: 'Task service unavailable' });
  await d.page.getByLabel('Task name').fill('Keep this draft');
  await d.page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(d.page.locator('.k-error')).toHaveText('Task service unavailable');
  await expect(d.page.getByLabel('Task name')).toHaveValue('Keep this draft');
  await d.control('recover', 'agent:create-task');
  await d.page.getByRole('button', { name: 'Submit request', exact: true }).click();
  await expect(d.page.getByLabel('Task name')).toHaveValue('');
});

test('completed idle opens the explanation dialog and submits the full period', async ({ desktop: d }) => {
  await d.advance(1020, true);
  await d.page.getByRole('button', { name: 'Continue working', exact: true }).click();
  await d.nav('Requests');
  await d.page.getByRole('button', { name: 'Explain', exact: true }).click();
  const dialog = d.page.getByRole('dialog', { name: 'Explain Idle Time', exact: true });
  await expect(dialog.getByRole('radio')).toBeChecked();
  await expect(dialog.getByLabel('Requested time', { exact: true })).toContainText('2');
  await expect(dialog.getByRole('button', { name: 'Submit to HR' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'What were you doing?' }).fill('I was reviewing printed client documents.');
  await d.control('fail', { method: 'agent:create-time-adjustment-request', message: 'HR service unavailable' });
  await dialog.getByRole('button', { name: 'Submit to HR' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('HR service unavailable');
  await expect(dialog.getByRole('textbox')).toHaveValue('I was reviewing printed client documents.');
  await d.control('recover', 'agent:create-time-adjustment-request');
  await dialog.getByRole('button', { name: 'Submit to HR' }).click();
  await expect(dialog.getByRole('status')).toContainText('was sent for review');
  await dialog.getByRole('button', { name: 'Close request' }).click();
  await expect(d.page.locator('.k-request-record')).toContainText('2 min');
  await d.page.getByRole('button', { name: 'View details', exact: true }).click();
  await expect(d.page.locator('.k-request-record-details')).toContainText('printed client documents');
  expect((await d.status()).timeAdjustmentRequests[0].requested_minutes).toBe(2);
});

test('early leave respects weekly balance and sends a valid request', async ({ desktop: d }) => {
  await d.nav('Requests');
  await d.page.getByRole('button', { name: 'Request', exact: true }).click();
  const dialog = d.page.getByRole('dialog', { name: 'Early Leave Permission', exact: true });
  await dialog.getByLabel('Requested leaving time').fill('14:00');
  await expect(dialog.getByRole('button', { name: 'Submit to HR' })).toBeDisabled();
  await dialog.getByLabel('Requested leaving time').fill('16:00');
  await expect(dialog.getByLabel('Requested minutes')).toHaveValue('60 min');
  await dialog.getByRole('textbox', { name: 'Reason (required)' }).fill('Doctor appointment in the afternoon.');
  await dialog.getByRole('button', { name: 'Submit to HR' }).click();
  await expect(dialog).toContainText('Early leave request sent');
  expect((await d.status()).timeAdjustmentRequests[0]).toMatchObject({ request_type: 'early_leave', requested_minutes: 60 });
});

test('annual leave calculates balance and appears under Pending requests', async ({ desktop: d }) => {
  await d.nav('Requests');
  await d.page.getByRole('button', { name: 'Plan leave', exact: true }).click();
  const dialog = d.page.getByRole('dialog', { name: 'Annual Leave', exact: true });
  await dialog.getByLabel('From date').fill('2026-11-01');
  await dialog.getByLabel('To date').fill('2026-11-02');
  await expect(dialog.getByLabel('Calculated working days')).toHaveValue('2 days');
  await expect(dialog.getByLabel('Expected balance')).toHaveValue('14 days');
  await dialog.getByRole('textbox', { name: 'Notes (optional)' }).fill('Family event');
  await dialog.getByRole('button', { name: 'Submit to HR' }).click();
  await expect(dialog).toContainText('Holiday request sent');
  await dialog.getByRole('button', { name: 'Close request' }).click();
  await d.page.getByRole('button', { name: /^Pending/ }).click();
  await expect(d.page.locator('.k-request-record')).toContainText('Annual Leave');
  await d.page.getByRole('button', { name: /^Approved/ }).click();
  await expect(d.page.locator('.k-request-record')).toHaveCount(0);
});

test('request dialogs close with Escape and restore keyboard focus', async ({ desktop: d }) => {
  await d.nav('Requests');
  const trigger = d.page.getByRole('button', { name: 'Plan leave', exact: true });
  await trigger.click();
  await d.page.keyboard.press('Escape');
  await expect(d.page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('shift reschedule keeps the shift length, rejects midnight overflow, and can be cancelled', async ({ desktop: d }) => {
  await d.nav('Requests');
  const form = d.page.locator('.k-shift-reschedule');
  await form.getByRole('combobox', { name: 'Day', exact: true }).selectOption('2026-10-29');
  await expect(form.getByLabel('New start time')).toBeEnabled();
  await form.getByLabel('New start time').fill('18:00');
  await expect(form.getByRole('button', { name: 'Request shift reschedule' })).toBeDisabled();
  await form.getByLabel('New start time').fill('10:00');
  await expect(form).toContainText('18:00');
  await form.getByLabel('Reason', { exact: true }).fill('Morning medical appointment.');
  await form.getByRole('button', { name: 'Request shift reschedule' }).click();
  await expect(form.locator('.k-shift-reschedule-row')).toContainText('Pending');
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(form.locator('.k-shift-reschedule-row')).toContainText('Cancelled');
});

test('meeting starts, suppresses idle detection, and ends with recorded time', async ({ desktop: d }) => {
  await d.nav('Meetings');
  await expect(d.page.getByRole('heading', { name: 'No meetings yet' })).toBeVisible();
  await d.page.getByLabel('Meeting title').fill('Client review');
  await d.page.getByLabel('Reason', { exact: false }).fill('Review the upcoming delivery.');
  await d.page.getByRole('button', { name: '30 min', exact: true }).click();
  await d.page.getByRole('button', { name: 'Start meeting', exact: true }).click();
  await expect(d.page.getByRole('button', { name: 'End meeting' })).toBeVisible();
  await d.advance(960, true);
  await expect(d.page.locator('.swal2-popup')).toHaveCount(0);
  // Raw inactivity remains recorded for approval/rejection accounting;
  // Meeting Mode suppresses the ordinary idle review while it runs.
  expect((await d.status()).idleSeconds).toBe(60);
  await expect(d.page.getByRole('timer', { name: 'Meeting elapsed time' })).toHaveText('00:16:00');
  await d.page.getByRole('button', { name: 'End meeting', exact: true }).click();
  await expect(d.page.locator('.k-meeting-list')).toContainText('Client review');
  expect((await d.status()).meetings[0]).toMatchObject({ status: 'pending', recordedSeconds: 960 });
});

test('meeting failure keeps the form editable for retry', async ({ desktop: d }) => {
  await d.nav('Meetings');
  await d.control('fail', { method: 'agent:start-meeting', message: 'Meeting service unavailable' });
  await d.page.getByLabel('Meeting title').fill('Team review');
  await d.page.getByLabel('Reason', { exact: false }).fill('Discuss blockers.');
  await d.page.getByRole('button', { name: 'Start meeting', exact: true }).click();
  await expect(d.page.getByRole('alert')).toHaveText('Meeting service unavailable');
  await expect(d.page.getByLabel('Meeting title')).toHaveValue('Team review');
  await d.control('recover', 'agent:start-meeting');
  await d.page.getByRole('button', { name: 'Start meeting', exact: true }).click();
  await expect(d.page.getByRole('button', { name: 'End meeting' })).toBeVisible();
});

test('meeting automatically ends at its expected duration while another screen is open', async ({ desktop: d }) => {
  await d.nav('Meetings');
  await d.page.getByLabel('Meeting title').fill('Quick check-in');
  await d.page.getByLabel('Reason', { exact: false }).fill('Confirm delivery ownership.');
  await d.page.getByLabel('Expected duration', { exact: true }).fill('1');
  await d.page.getByRole('button', { name: 'Start meeting', exact: true }).click();
  await expect(d.page.getByRole('button', { name: 'End meeting' })).toBeVisible();
  await d.nav('Tracker');
  await d.advance(59);
  expect((await d.status()).activeMeeting).not.toBeNull();
  await d.advance(1);
  expect((await d.status()).activeMeeting).toBeNull();
  expect((await d.status()).meetings[0].recordedSeconds).toBe(60);
  await d.advance(5);
  expect((await d.status()).meetings).toHaveLength(1);
});

test('tracker filters tasks by project and sends a quick task request', async ({ desktop: d }) => {
  await d.page.getByRole('button', { name: 'Project', exact: true }).click();
  await d.page.getByRole('option', { name: 'Internal tools', exact: true }).click();
  await d.page.getByRole('button', { name: 'Task', exact: true }).click();
  await expect(d.page.getByRole('option', { name: 'Prepare client delivery', exact: true })).toHaveCount(0);
  await d.page.getByRole('option', { name: 'Improve internal tools', exact: true }).click();
  expect((await d.status()).selectedTask.id).toBe('task-b');
  await d.page.getByRole('textbox', { name: 'New task name', exact: true }).fill('Improve the onboarding guide');
  await d.page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d.page.getByRole('textbox', { name: 'New task name', exact: true })).toHaveValue('');
  const call = (await d.control('inspect')).calls.find((row: any) => row.method === 'agent:create-task');
  expect(call.args[0]).toMatchObject({ name: 'Improve the onboarding guide', projectId: 'project-b' });
});

test('failed meeting sync shows its error and can be retried', async ({ desktop: d }) => {
  await d.control('patch', { meetings: [{ id: 'meeting-retry', title: 'Offline meeting', reason: 'Client call', startedAt: '2026-10-27T08:00:00Z', endedAt: '2026-10-27T08:10:00Z', recordedSeconds: 600, lifecycleState: 'ended', status: 'pending', syncState: 'end_error', lastError: 'Connection lost' }] });
  await d.nav('Meetings');
  await expect(d.page.getByRole('alert')).toHaveText('Connection lost');
  await d.page.getByRole('button', { name: 'Retry sync' }).click();
  await expect(d.page.getByRole('button', { name: 'Retry sync' })).toHaveCount(0);
  expect((await d.control('inspect')).calls.some((row: any) => row.method === 'agent:retry-meeting-sync')).toBe(true);
});

test('screenshots refresh, render captures, and open the portal action', async ({ desktop: d }) => {
  await d.nav('Shots');
  await expect(d.page.getByRole('heading', { name: 'No screenshots yet' })).toBeVisible();
  await d.control('screenshots', [{ id: 'shot-a', displayName: 'Test display', capturedAt: '2026-10-27T09:00:00Z', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6p8AAAAASUVORK5CYII=' }]);
  await d.page.getByRole('button', { name: 'Refresh screenshots' }).click();
  await expect(d.page.getByRole('img', { name: 'Test display' })).toBeVisible();
  await d.page.getByRole('button', { name: 'Manage screenshots in web dashboard' }).click();
  expect((await d.control('inspect')).calls.some((row: any) => row.method === 'agent:open-employee-dashboard')).toBe(true);
});

test('screenshots show policy-disabled and recoverable error states', async ({ desktop: d }) => {
  await d.control('patch', { screenshotMonitoringEnabled: false });
  await d.nav('Shots');
  await expect(d.page.getByRole('heading', { name: 'Screenshot capture is disabled' })).toBeVisible();
  await d.control('patch', { screenshotMonitoringEnabled: true });
  await d.control('fail', { method: 'agent:get-recent-screenshots', message: 'Capture service unavailable' });
  await d.page.getByRole('button', { name: 'Refresh screenshots' }).click();
  await expect(d.page.getByRole('alert')).toContainText('Capture service unavailable');
  await d.control('recover', 'agent:get-recent-screenshots');
  await d.page.getByRole('button', { name: 'Refresh screenshots' }).click();
  await expect(d.page.getByRole('alert')).toHaveCount(0);
});

test('shift and insights render synced work totals and empty states', async ({ desktop: d }) => {
  await d.nav('Shift');
  await expect(d.page.getByLabel('Shift summary')).toBeVisible();
  await d.nav('Insights');
  await expect(d.page.getByRole('heading', { name: 'No activity summary yet' })).toBeVisible();
  const period = { active_seconds: 5400, tracked_active_seconds: 3600, manual_approved_seconds: 1800, manual_pending_seconds: 600, idle_seconds: 300 };
  await d.control('patch', { timeSummary: { today: period, week: period, month: period } });
  await expect(d.page.getByLabel('Today work summary')).toContainText('1h 30m');
  await expect(d.page.locator('.wp-insight-card')).toHaveCount(3);
  await expect(d.page.getByLabel('This week work summary')).toContainText('Pending approval');
});
