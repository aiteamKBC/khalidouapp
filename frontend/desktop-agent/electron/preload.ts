import electronRenderer from "electron/renderer";
import type { QuoteReminderPayload } from "./services/quoteReminderWindow.js";

const { contextBridge, ipcRenderer } = electronRenderer;

contextBridge.exposeInMainWorld("khaliduo", {
  showQuoteReminder: (payload: QuoteReminderPayload) => ipcRenderer.invoke("quote:show", payload),
  getQuoteReminder: () => ipcRenderer.invoke("quote:get"),
  dismissQuoteReminder: () => ipcRenderer.invoke("quote:dismiss"),
  resizeQuoteReminder: (height: number) => ipcRenderer.send("quote:resize", height),
  onQuoteReminderChanged: (callback: (payload: QuoteReminderPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: QuoteReminderPayload) => callback(payload);
    ipcRenderer.on("quote:changed", listener);
    return () => ipcRenderer.removeListener("quote:changed", listener);
  },
  getAgentStatus: () => ipcRenderer.invoke("agent:get-status"),
  getAppearance: (scope: string) => ipcRenderer.invoke("agent:get-appearance", scope),
  setAppearance: (scope: string, patch: { skin?: "orbit" | "ember" | "forest"; mode?: "light" | "dark" }) => ipcRenderer.invoke("agent:set-appearance", scope, patch),
  syncNow: () => ipcRenderer.invoke("agent:sync-now"),
  onStatusChanged: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) =>
      callback(status);
    ipcRenderer.on("agent:status-changed", listener);
    return () => ipcRenderer.removeListener("agent:status-changed", listener);
  },
  enrollWithCredentials: (email: string, password: string) =>
    ipcRenderer.invoke("agent:enroll-with-credentials", email, password),
  pauseTracking: (options?: { requestedMinutes?: number; reason?: string; takeBreak?: boolean }) =>
    ipcRenderer.invoke("agent:pause-tracking", options),
  resumeTracking: () => ipcRenderer.invoke("agent:resume-tracking"),
  endShift: () => ipcRenderer.invoke("agent:end-shift"),
  resumeAutomaticIdle: () => ipcRenderer.invoke("agent:resume-automatic-idle"),
  startMeeting: (input: {
    title: string;
    reason: string;
    expectedEndMinutes: number;
    projectId?: string | null;
    taskId?: string | null;
  }) => ipcRenderer.invoke("agent:start-meeting", input),
  endMeeting: () => ipcRenderer.invoke("agent:end-meeting"),
  refreshMeetings: () => ipcRenderer.invoke("agent:refresh-meetings"),
  retryMeetingSync: () => ipcRenderer.invoke("agent:retry-meeting-sync"),
  confirmTrackingStart: () =>
    ipcRenderer.invoke("agent:confirm-tracking-start"),
  declineTrackingStart: () =>
    ipcRenderer.invoke("agent:decline-tracking-start"),
  logout: () => ipcRenderer.invoke("agent:logout"),
  openEmployeeDashboard: (section?: "screenshots") =>
    ipcRenderer.invoke("agent:open-employee-dashboard", section),
  getRecentScreenshots: () =>
    ipcRenderer.invoke("agent:get-recent-screenshots"),
  setCurrentTask: (taskId: string | null) =>
    ipcRenderer.invoke("agent:set-current-task", taskId),
  createTask: (options: {
    name: string;
    projectId?: string;
    description?: string;
    stage?: "assigned";
    startDate?: string;
    deadline?: string;
    estimatedMinutes?: number;
  }) => ipcRenderer.invoke("agent:create-task", options),
  updateTaskStage: (taskId: string, stage: string, note?: string) =>
    ipcRenderer.invoke("agent:update-task-stage", taskId, stage, note),
  createTaskChecklistItem: (taskId: string, title: string) =>
    ipcRenderer.invoke("agent:create-task-checklist-item", taskId, title),
  updateTaskChecklistItem: (
    taskId: string,
    itemId: string,
    completed: boolean,
  ) =>
    ipcRenderer.invoke(
      "agent:update-task-checklist-item",
      taskId,
      itemId,
      completed,
    ),
  deleteTaskChecklistItems: (taskId: string, itemIds: string[]) =>
    ipcRenderer.invoke("agent:delete-task-checklist-items", taskId, itemIds),
  createTimeAdjustmentRequest: (input: {
    requestedMinutes: number;
    reason: string;
    requestType?: "idle_time" | "early_leave" | "manual_time" | "delayed_break";
    requestedDate?: string;
    workSessionId?: string;
    sourceStartAt?: string;
    sourceEndAt?: string;
    requestedLeaveTime?: string;
  }) => ipcRenderer.invoke("agent:create-time-adjustment-request", input),
  createLeaveRequest: (input: {
    startDate: string;
    endDate: string;
    leaveType?: "annual" | "sick" | "unpaid";
    reason?: string;
  }) => ipcRenderer.invoke("agent:create-leave-request", input),
  listShiftReschedules: () =>
    ipcRenderer.invoke("agent:list-shift-reschedules"),
  getShiftRescheduleDay: (workDate: string) =>
    ipcRenderer.invoke("agent:get-shift-reschedule-day", workDate),
  createShiftReschedule: (input: {
    workDate: string;
    requestedStart: string;
    requestedEnd: string;
    reason: string;
  }) => ipcRenderer.invoke("agent:create-shift-reschedule", input),
  cancelShiftReschedule: (requestId: string) =>
    ipcRenderer.invoke("agent:cancel-shift-reschedule", requestId),
  setIdleAlertAttention: (active: boolean) =>
    ipcRenderer.send("agent:set-idle-alert-attention", active),
  setUpdateAttention: (active: boolean) =>
    ipcRenderer.send("agent:set-update-attention", active),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  isWindowExpanded: () => ipcRenderer.invoke("window:is-expanded"),
  onWindowExpandedChanged: (callback: (expanded: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, expanded: boolean) => callback(expanded);
    ipcRenderer.on("window:expanded-changed", listener);
    return () => ipcRenderer.removeListener("window:expanded-changed", listener);
  },
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  checkForUpdates: () => ipcRenderer.invoke("agent:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("agent:install-update"),
  onRequiredUpdate: (
    callback: (update: { version: string | null }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      update: { version: string | null },
    ) => callback(update);
    ipcRenderer.on("agent:update-required", listener);
    return () => ipcRenderer.removeListener("agent:update-required", listener);
  },
  onIdleAlert: (
    callback: (alert: {
      id: string;
      kind: "idle_return" | "tracking_start" | "idle_started";
      lostSeconds: number;
      eligibleLostSeconds: number;
      outsideScheduledShift: boolean;
      endedAt: string;
    }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      alert: {
        id: string;
        kind: "idle_return" | "tracking_start" | "idle_started";
        lostSeconds: number;
        eligibleLostSeconds: number;
        outsideScheduledShift: boolean;
        endedAt: string;
      },
    ) => callback(alert);
    ipcRenderer.on("agent:idle-alert", listener);
    return () => ipcRenderer.removeListener("agent:idle-alert", listener);
  },
});
