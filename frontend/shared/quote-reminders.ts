export type QuoteLanguage = "both" | "ar" | "en";
export type QuoteSettings = {
  enabled: boolean;
  minutes: number;
  language: QuoteLanguage;
  nextAt: number;
  sequence: number;
};

// Original, unattributed encouragement; available offline without a third-party feed.
const quotes = [
  [
    "خطوة صغيرة كل يوم تصنع فرقًا كبيرًا مع الوقت.",
    "A small step each day adds up to meaningful progress.",
  ],
  [
    "ابدأ بما تستطيع، ثم حسّن الطريق وأنت تمضي.",
    "Start with what you can do, then improve as you go.",
  ],
  ["امنح مهمة واحدة انتباهك الكامل.", "Give one task your full attention."],
  ["التقدم الهادئ يظل تقدمًا.", "Quiet progress is still progress."],
  ["استراحة قصيرة قد تمنحك فكرة أوضح.", "A short pause can bring a clearer idea."],
  [
    "اسأل حين تحتاج، فالتعلم يبدأ بسؤال.",
    "Ask when you need help; learning begins with a question.",
  ],
  [
    "قدّر ما أنجزته، ثم اختر خطوتك التالية.",
    "Notice what you have accomplished, then choose your next step.",
  ],
  ["الاستمرار أهم من يوم مثالي.", "Consistency matters more than a perfect day."],
  ["كل محاولة فرصة لتتعلم شيئًا جديدًا.", "Every attempt is a chance to learn something new."],
  ["رتّب أولوياتك واترك مساحة للتنفس.", "Set your priorities and leave room to breathe."],
  [
    "شارك فكرة مفيدة؛ فقد تسهّل يوم شخص آخر.",
    "Share a useful idea; it may make someone else's day easier.",
  ],
  ["يمكنك أن تبدأ من جديد بخطوة واحدة.", "You can make a fresh start with one step."],
] as const;

export function defaultQuoteSettings(now = Date.now()): QuoteSettings {
  return { enabled: true, minutes: 60, language: "both", nextAt: now + 60 * 60_000, sequence: 0 };
}

export function validQuoteMinutes(minutes: number) {
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;
}

export function readQuoteSettings(raw: string | null, now = Date.now()): QuoteSettings {
  try {
    const value = JSON.parse(raw ?? "null");
    if (
      !value ||
      typeof value.enabled !== "boolean" ||
      !validQuoteMinutes(value.minutes) ||
      !["both", "ar", "en"].includes(value.language) ||
      !Number.isSafeInteger(value.nextAt) ||
      value.nextAt < 0 ||
      (value.enabled && value.nextAt === 0) ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0 ||
      value.sequence >= quotes.length * 2
    )
      return defaultQuoteSettings(now);
    return value;
  } catch {
    return defaultQuoteSettings(now);
  }
}

export function loadQuoteSettings(
  storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void },
  key: string,
  now = Date.now(),
) {
  const raw = storage.getItem(key);
  const settings = readQuoteSettings(raw, now);
  const saved = JSON.stringify(settings);
  // Save the first deadline once: polling/reloading must not keep postponing it.
  // A previously saved opt-out remains disabled.
  if (raw !== saved) storage.setItem(key, saved);
  return settings;
}

export function quoteAt(language: QuoteLanguage, sequence: number) {
  const index = language === "both" ? Math.floor(sequence / 2) : sequence;
  const column = language === "ar" || (language === "both" && sequence % 2 === 0) ? 0 : 1;
  return quotes[index % quotes.length][column];
}

export function translateQuote(text: string): string {
  const pair = quotes.find(([arabic, english]) => text === arabic || text === english);
  return pair ? (text === pair[0] ? pair[1] : pair[0]) : text;
}

export function consumeDueQuote(settings: QuoteSettings, now: number) {
  if (!settings.enabled || now < settings.nextAt) return null;
  return {
    text: quoteAt(settings.language, settings.sequence),
    settings: {
      ...settings,
      // Resume with one reminder after sleep, rather than replaying missed intervals.
      nextAt: now + settings.minutes * 60_000,
      sequence: (settings.sequence + 1) % (quotes.length * 2),
    },
  };
}
