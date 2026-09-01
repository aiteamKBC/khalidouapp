export type ForegroundScreenshotActivity = {
  processName?: string | null;
  applicationName?: string | null;
  siteDomain?: string | null;
};

function normalizedApplicationValue(value?: string | null) {
  return (value ?? "")
    .trim()
    .replace(/\.exe$/i, "")
    .toLowerCase();
}

export function isWhatsAppScreenshotActivity(
  activity?: ForegroundScreenshotActivity | null,
) {
  if (!activity) return false;
  const processName = normalizedApplicationValue(activity.processName);
  const applicationName = normalizedApplicationValue(activity.applicationName);
  const siteDomain = normalizedApplicationValue(activity.siteDomain).replace(/^www\./, "");
  return (
    processName === "whatsapp" ||
    processName === "whatsappbeta" ||
    applicationName.includes("whatsapp") ||
    siteDomain === "web.whatsapp.com" ||
    siteDomain.endsWith(".whatsapp.com")
  );
}

export function privacyBlurSampleSize(width: number, height: number) {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const sampleWidth = Math.min(48, safeWidth);
  return {
    width: sampleWidth,
    height: Math.max(1, Math.round((safeHeight / safeWidth) * sampleWidth)),
  };
}
