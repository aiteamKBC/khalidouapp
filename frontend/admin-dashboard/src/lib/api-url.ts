export function resolveApiUrl(
  apiBaseUrl: string,
  path: string,
  runtimeOrigin: string,
): string | null {
  const base = new URL(`${apiBaseUrl.replace(/\/$/, "")}/`, runtimeOrigin);
  const normalizedPath = path.startsWith("/api/v1/")
    ? path.slice("/api/v1/".length)
    : path.replace(/^\/+/, "");
  const target =
    path.startsWith("http://") || path.startsWith("https://")
      ? new URL(path)
      : new URL(normalizedPath, base);
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  const baseRoot = basePath.slice(0, -1);

  if (
    target.username ||
    target.password ||
    target.origin !== base.origin ||
    (target.pathname !== baseRoot && !target.pathname.startsWith(basePath))
  ) {
    return null;
  }
  return target.toString();
}
