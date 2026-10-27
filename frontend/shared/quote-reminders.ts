export type QuoteLanguage = "both" | "ar" | "en";
export type QuoteSettings = {
  enabled: boolean;
  minutes: number;
  language: QuoteLanguage;
  nextAt: number;
  sequence: number;
};

// Short, sourced excerpts. Arabic translations are ours; the catalogue works offline.
const quotes = [
  {
    ar: "ليست لدي موهبة خاصة؛ إنما أنا شديد الفضول.",
    en: "I have no special talent, I am only passionately curious.",
    author: { ar: "ألبرت أينشتاين", en: "Albert Einstein" },
    source: "https://www.amnh.org/content/download/58314/943011/file/einstein-educator-s-guide.pdf",
  },
  {
    ar: "علينا أن نتحلّى بالمثابرة، وقبل كل شيء بالثقة في أنفسنا.",
    en: "We must have perseverance and above all confidence in ourselves.",
    author: { ar: "ماري كوري", en: "Marie Curie" },
    source: "https://www.mariecurie.org.uk/about-us/our-history/marie-curie-the-scientist",
  },
  {
    ar: "مهما بدت الحياة صعبة، هناك دائمًا شيء يمكنك فعله والنجاح فيه.",
    en: "However difficult life may seem, there is always something you can do, and succeed at.",
    author: { ar: "ستيفن هوكينج", en: "Stephen Hawking" },
    source: "https://www.hawking.org.uk/in-words/speeches/speech-5",
  },
  {
    ar: "ما لا أستطيع صنعه، لا أفهمه.",
    en: "What I cannot create I do not understand.",
    author: { ar: "ريتشارد فاينمان", en: "Richard Feynman" },
    source: "https://feynman.com/fun/quotes/",
  },
  {
    ar: "إذا كنت قد رأيت أبعد، فذلك لأنني وقفت على أكتاف العمالقة.",
    en: "If I have seen further, it is by standing on the shoulders of giants.",
    author: { ar: "إسحاق نيوتن", en: "Isaac Newton" },
    source: "https://digitallibrary.hsp.org/index.php/Detail/objects/9792",
  },
  {
    ar: "العبقرية واحد بالمئة إلهام، وتسعة وتسعون بالمئة عرق.",
    en: "Genius is one percent inspiration and ninety-nine percent perspiration.",
    author: { ar: "توماس إديسون", en: "Thomas Edison" },
    source: "https://www.nps.gov/edis/learn/kidsyouth/edison-and-his-era.htm",
  },
  {
    ar: "كنت أطرح الأسئلة؛ أردت أن أعرف لماذا.",
    en: "I asked questions; I wanted to know why.",
    author: { ar: "كاثرين جونسون", en: "Katherine Johnson" },
    source: "https://www.nasa.gov/learning-resources/katherine-johnson-a-lifetime-of-stem/",
  },
  {
    ar: "ما تفعله يُحدث فرقًا، وعليك أن تقرر أي فرق تريد أن تُحدثه.",
    en: "What you do makes a difference, and you have to decide what kind of difference you want to make.",
    author: { ar: "جين جودال", en: "Jane Goodall" },
    source: "https://janegoodall.org/news/eatmeatless-for-people-other-animals-and-the-environment/",
  },
  {
    ar: "وقتك محدود، فلا تُضعه في عيش حياة شخص آخر.",
    en: "Your time is limited, so don’t waste it living someone else’s life.",
    author: { ar: "ستيف جوبز", en: "Steve Jobs" },
    source: "https://news.stanford.edu/stories/2005/06/youve-got-find-love-jobs-says",
  },
  {
    ar: "إن لم تستطع الطيران فاركض، وإن لم تستطع الركض فامشِ، وإن لم تستطع المشي فازحف.",
    en: "If you can’t fly, run; if you can’t run, walk; if you can’t walk—CRAWL.",
    author: { ar: "مارتن لوثر كينج", en: "Martin Luther King Jr." },
    source: "https://kinginstitute.stanford.edu/king-papers/documents/quotable-quotes-rev-king",
  },
  {
    ar: "التفاؤل هو الإيمان الذي يقود إلى الإنجاز؛ لا شيء يتحقق بلا أمل.",
    en: "Optimism is the faith that leads to achievement; nothing can be done without hope.",
    author: { ar: "هيلين كيلر", en: "Helen Keller" },
    source: "https://afb.org/about-afb/history/helen-keller/books-essays-speeches/optimism-1903",
  },
  {
    ar: "إتقان العمل خير من إتقان الكلام.",
    en: "Well done is better than well said.",
    author: { ar: "بنجامين فرانكلين", en: "Benjamin Franklin" },
    source: "https://founders.archives.gov/documents/Franklin/01-02-02-0028",
  },
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
  const column = language === "ar" || (language === "both" && sequence % 2 === 0) ? "ar" : "en";
  return quotes[index % quotes.length][column];
}

export function translateQuote(text: string): string {
  const quote = quotes.find(quote => text === quote.ar || text === quote.en);
  return quote ? (text === quote.ar ? quote.en : quote.ar) : text;
}

export function quoteAttribution(text: string) {
  const quote = quotes.find(quote => text === quote.ar || text === quote.en);
  if (!quote) return null;
  const language = text === quote.ar ? "ar" : "en";
  return { author: quote.author[language], language, source: quote.source };
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
