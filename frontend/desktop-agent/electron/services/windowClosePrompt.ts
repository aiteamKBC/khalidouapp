export type WindowCloseRequest = { id: string; paused: boolean };
export type WindowCloseChoice = "hide" | "toggle" | "quit" | "cancel";
export type WindowCloseResult = { success: boolean; message?: string };
