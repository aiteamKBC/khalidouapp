import electronRenderer from "electron/renderer";

const { contextBridge, ipcRenderer } = electronRenderer;

contextBridge.exposeInMainWorld("khaliduo", {
  getAgentStatus: () => ipcRenderer.invoke("agent:get-status"),
  enrollWithCredentials: (email: string, password: string) =>
    ipcRenderer.invoke("agent:enroll-with-credentials", email, password),
  pauseTracking: (options?: { requestedMinutes?: number; reason?: string }) =>
    ipcRenderer.invoke("agent:pause-tracking", options),
  resumeTracking: () => ipcRenderer.invoke("agent:resume-tracking"),
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
  createTimeAdjustmentRequest: (input: {
    requestedMinutes: number;
    reason: string;
    requestType?: "idle_time" | "early_leave" | "manual_time";
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
  setIdleAlertAttention: (active: boolean) =>
    ipcRenderer.send("agent:set-idle-alert-attention", active),
  setUpdateAttention: (active: boolean) =>
    ipcRenderer.send("agent:set-update-attention", active),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
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
