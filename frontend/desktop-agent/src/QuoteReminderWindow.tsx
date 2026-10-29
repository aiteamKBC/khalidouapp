import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { QuoteReminderPayload } from "../electron/services/quoteReminderWindow";
import { quoteAttribution, translateQuote } from "../../shared/quote-reminders";
import { TrackerIcon } from "./tracker-ui/TrackerIcon";
import "./quote-reminders.css";
import "./quote-window.css";

export default function QuoteReminderWindow() {
  const [quote, setQuote] = useState<QuoteReminderPayload | null>(null);
  const card = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    let receivedUpdate = false;
    const unsubscribe = window.khaliduo?.onQuoteReminderChanged(payload => {
      receivedUpdate = true;
      if (active) setQuote(payload);
    });
    void window.khaliduo?.getQuoteReminder().then(payload => {
      if (active && !receivedUpdate) setQuote(payload);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!card.current) return;
    const resize = () => {
      if (card.current) window.khaliduo?.resizeQuoteReminder(Math.ceil(Math.max(card.current.getBoundingClientRect().height, card.current.scrollHeight + 2)) + 20);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(card.current);
    resize();
    return () => observer.disconnect();
  }, [quote]);

  if (!quote) return null;
  const attribution = quoteAttribution(quote.text);
  const translatedText = translateQuote(quote.text);
  return (
    <aside ref={card} className="native-quote-reminder" style={quote.colors as CSSProperties} role="status" aria-live="polite" aria-label="Quote reminder">
      <div>
        <strong>A moment of inspiration</strong>
        <div className="native-quote-actions">
          {translatedText !== quote.text && <button type="button" aria-label="Translate quote" title="Translate quote" onClick={() => setQuote(current => current && { ...current, text: translatedText })}>
            <TrackerIcon className="ri-translate-line" aria-hidden="true" />
          </button>}
          <button type="button" aria-label="Dismiss quote" onClick={() => void window.khaliduo?.dismissQuoteReminder()}>
            ×
          </button>
        </div>
      </div>
      <p dir="auto" lang={/[\u0600-\u06ff]/.test(quote.text) ? "ar" : "en"}>{quote.text}</p>
      {attribution && (
        <footer className="native-quote-author" dir="auto" lang={attribution.language}>
          <cite title={attribution.source}>{attribution.author}</cite>
        </footer>
      )}
      {!attribution && quote.author && <footer className="native-quote-author" dir="auto" lang={/[\u0600-\u06ff]/.test(quote.author) ? "ar" : "en"}><cite>{quote.author}</cite></footer>}
      {quote.provider && (
        <button type="button" className="native-quote-provider" onClick={() => void window.khaliduo?.openQuoteSource()}>
          Quotes via {quote.provider === "zenquotes" ? "ZenQuotes" : "Quote Unquote"} <span aria-hidden="true">↗</span>
        </button>
      )}
    </aside>
  );
}
