export function normalizeAiAcronym(value: string): string {
  return value.replace(/\bai\b/gi, "AI");
}
