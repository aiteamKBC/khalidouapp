type HttpLikeError = {
  status?: unknown;
  name?: unknown;
};

export function retryTransientRequest(failureCount: number, error: unknown) {
  const candidate =
    typeof error === "object" && error !== null ? (error as HttpLikeError) : undefined;
  if (candidate?.name === "AbortError") return false;

  const status = typeof candidate?.status === "number" ? candidate.status : undefined;
  if (status !== undefined) {
    if ([400, 401, 403, 404].includes(status)) return false;
    return (status === 0 || status >= 500) && failureCount < 2;
  }
  return failureCount < 2;
}
