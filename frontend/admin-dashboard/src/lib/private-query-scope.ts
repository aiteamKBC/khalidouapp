export function jwtSubjectScopeKey(token: string, fallback = "current-session") {
  try {
    const encodedPayload = token.split(".")[1];
    if (!encodedPayload) return fallback;
    const normalized = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as {
      company_id?: string;
      sub?: string;
    };
    if (!payload.company_id || !payload.sub) return fallback;
    return `${payload.company_id}:${payload.sub}`;
  } catch {
    return fallback;
  }
}

export function protectedImageQueryKey(src: string, authToken?: string) {
  return [
    "protected-image",
    authToken ? "employee" : "admin",
    authToken ? jwtSubjectScopeKey(authToken, "employee-session") : "admin-session",
    src,
  ] as const;
}
