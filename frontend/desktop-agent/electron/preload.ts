import electronRenderer from "electron/renderer";

const { contextBridge, ipcRenderer } = electronRenderer;

contextBridge.exposeInMainWorld("khaliduo", {
  getAgentStatus: () => ipcRenderer.invoke("agent:get-status"),
  enrollDevice: (enrollmentCode: string) =>
    ipcRenderer.invoke("agent:enroll-device", enrollmentCode),
  enrollWithCredentials: (email: string, password: string) =>
    ipcRenderer.invoke("agent:enroll-with-credentials", email, password),
  pauseTracking: () => ipcRenderer.invoke("agent:pause-tracking"),
  resumeTracking: () => ipcRenderer.invoke("agent:resume-tracking"),
  openEmployeeDashboard: () =>
    ipcRenderer.invoke("agent:open-employee-dashboard"),
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
  createTimeAdjustmentRequest: (requestedMinutes: number, reason: string) =>
    ipcRenderer.invoke(
      "agent:create-time-adjustment-request",
      requestedMinutes,
      reason,
    ),
  onIdleAlert: (
    callback: (alert: {
      id: string;
      lostSeconds: number;
      endedAt: string;
    }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      alert: { id: string; lostSeconds: number; endedAt: string },
    ) => callback(alert);
    ipcRenderer.on("agent:idle-alert", listener);
    return () => ipcRenderer.removeListener("agent:idle-alert", listener);
  },
});
