import axios from "axios";

type ApiErrorPayload = {
  error?: { message?: string };
  detail?: string;
};

export function getUserFacingError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as ApiErrorPayload | undefined;
    const apiMessage = data?.error?.message ?? data?.detail;
    if (apiMessage) return apiMessage;

    if (
      error.code === "ECONNABORTED" ||
      error.code === "ETIMEDOUT" ||
      error.message.toLowerCase().includes("timeout")
    ) {
      return "The server took too long to respond. Please try again when the connection recovers.";
    }

    if (!error.response) {
      return "The server could not be reached. Your saved work will sync when the connection recovers.";
    }

    return error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}
