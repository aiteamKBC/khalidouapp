import { useEffect, useState } from "react";
import Drawer from "./Drawer";
import { WorkspaceIcon } from "./WorkspaceIcon";
import {
  consumeDueQuote,
  defaultQuoteSettings,
  quoteAt,
  loadQuoteSettings,
  validQuoteMinutes,
  translateQuote,
  type QuoteLanguage,
} from "./quote-reminders";

export default function QuoteReminders({
  employeeId,
  open,
  onClose,
}: {
  employeeId: string;
  open: boolean;
  onClose: () => void;
}) {
  const storageKey = `khaliduo:quote-reminders:v1:${employeeId}`;
  const [settings, setSettings] = useState(defaultQuoteSettings);
  const [enabled, setEnabled] = useState(true);
  const [minutes, setMinutes] = useState("60");
  const [language, setLanguage] = useState<QuoteLanguage>("both");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    const read = () => loadQuoteSettings(localStorage, storageKey);
    const refresh = () => {
      try {
        if (active) setSettings(read());
      } catch {
        /* Delivery waits until the preference and deadline can be saved. */
      }
    };
    refresh();
    const claim = () => {
      if (!active || document.visibilityState !== "visible") return;
      try {
        const current = read();
        const due = consumeDueQuote(current, Date.now());
        if (!due) return;
        localStorage.setItem(storageKey, JSON.stringify(due.settings));
        setSettings(due.settings);
        setMessage(due.text);
      } catch {
        /* Do not repeatedly display a reminder if its deadline cannot be saved. */
      }
    };
    const tick = () => {
      // Only one visible tab claims a deadline for this employee.
      if (navigator.locks) {
        void navigator.locks.request(storageKey, claim).catch(() => {});
      } else claim();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) refresh();
    };
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("storage", onStorage);
    tick();
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("storage", onStorage);
    };
  }, [storageKey]);

  useEffect(() => {
    if (!open) return;
    setEnabled(settings.enabled);
    setMinutes(String(settings.minutes));
    setLanguage(settings.language);
  }, [open, settings.enabled, settings.minutes, settings.language]);

  useEffect(() => {
    setError("");
    setSaved(false);
  }, [open]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 20_000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const save = () => {
    const interval = Number(minutes);
    if (!validQuoteMinutes(interval)) {
      setError("Choose a whole number from 1 to 1440 minutes.");
      return;
    }
    try {
      const next = {
        ...settings,
        enabled,
        minutes: interval,
        language,
        nextAt: enabled ? Date.now() + interval * 60_000 : 0,
      };
      localStorage.setItem(storageKey, JSON.stringify(next));
      setSettings(next);
      setMessage(null);
      setError("");
      setSaved(true);
    } catch {
      setError("Your browser could not save this setting. Allow site storage and try again.");
    }
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        eyebrow="Personal preferences"
        title="Quote reminders"
        description="Enabled by default. Change the interval or turn reminders off here."
        footer={
          <button
            type="submit"
            form="quote-reminder-settings"
            className="cursor-pointer rounded-md bg-ew-solid px-3.5 py-2 text-[12.5px] font-semibold text-white"
          >
            Save reminders
          </button>
        }
      >
        <form
          id="quote-reminder-settings"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          onChange={() => setSaved(false)}
        >
          <label className="flex items-center gap-2 text-[13px] font-medium text-ew-ink">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable quote reminders
          </label>
          <div>
            <label htmlFor="quote-minutes" className="k-field-label">
              Remind me every (minutes)
            </label>
            <input
              id="quote-minutes"
              type="number"
              min={1}
              max={1440}
              step={1}
              required
              className="k-input"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="quote-language" className="k-field-label">
              Quote language
            </label>
            <select
              id="quote-language"
              className="k-input"
              value={language}
              onChange={(event) => setLanguage(event.target.value as QuoteLanguage)}
            >
              <option value="both">العربية & English</option>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
          <p className="text-[12px] text-ew-muted">
            Saved for your account on this browser. Reminders appear while your workspace is open
            and visible, including web tracker mode. The first arrives after the interval you
            select.
          </p>
          <button
            type="button"
            className="cursor-pointer rounded-md border border-ew-line px-3 py-2 text-[12.5px] font-semibold text-ew-plum"
            onClick={() => setMessage(quoteAt(language, settings.sequence))}
          >
            Preview quote
          </button>
          {error && (
            <p role="alert" className="text-[12px] text-ew-bad">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="text-[12px] text-ew-ok">
              {enabled
                ? `Reminders saved. Your next quote is in ${Number(minutes)} minute(s).`
                : "Quote reminders are off."}
            </p>
          )}
        </form>
      </Drawer>
      {message && (
        <aside
          role="status"
          aria-live="polite"
          aria-label="Quote reminder"
          className="fixed bottom-20 right-4 z-[70] w-[calc(100vw-32px)] max-w-sm rounded-xl border border-ew-line bg-ew-card p-4 text-ew-ink shadow-lg"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="k-label">A moment of inspiration</p>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label="Translate quote"
                title="Translate quote"
                onClick={() => setMessage(current => current ? translateQuote(current) : null)}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[16px] text-ew-muted hover:bg-ew-bg-2 hover:text-ew-ink focus-visible:outline-2 focus-visible:outline-ew-plum"
              >
                <WorkspaceIcon className="ri-translate-line" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Dismiss quote"
                onClick={() => setMessage(null)}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[20px] text-ew-muted hover:bg-ew-bg-2 hover:text-ew-ink focus-visible:outline-2 focus-visible:outline-ew-plum"
              >
                ×
              </button>
            </div>
          </div>
          <p dir="auto" className="mt-2 text-[14px] leading-relaxed">
            {message}
          </p>
        </aside>
      )}
    </>
  );
}
