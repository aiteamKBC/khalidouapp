import { useEffect, useState } from "react";
import {
  consumeDueQuote,
  defaultQuoteSettings,
  loadQuoteSettings,
  validQuoteMinutes,
  translateQuote,
  type QuoteSettings,
} from "../../shared/quote-reminders";

export function useQuoteReminders(scope: string | null) {
  const storageKey = scope ? `khaliduo:quote-reminders:v1:${scope}` : null;
  const [state, setState] = useState<{ key: string | null; settings: QuoteSettings }>(() => ({
    key: null, settings: defaultQuoteSettings(),
  }));
  const [message, setMessage] = useState<{ key: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMessage(null);
    setError(null);
    if (!storageKey) return;
    let active = true;
    const read = () => loadQuoteSettings(localStorage, storageKey);
    const refresh = () => {
      try {
        const settings = read();
        if (active) setState({ key: storageKey, settings });
      } catch {
        if (active) setError("Quote reminders need permission to save preferences on this device.");
      }
    };
    const claim = () => {
      if (!active || document.visibilityState !== "visible") return;
      try {
        const due = consumeDueQuote(read(), Date.now());
        if (!due) return;
        localStorage.setItem(storageKey, JSON.stringify(due.settings));
        setState({ key: storageKey, settings: due.settings });
        setMessage({ key: storageKey, text: due.text });
      } catch {
        // Do not display again until a new deadline has been saved successfully.
      }
    };
    const tick = () => {
      if (navigator.locks) void navigator.locks.request(storageKey, claim).catch(() => {});
      else claim();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) refresh();
    };
    refresh();
    tick();
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("storage", onStorage);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("storage", onStorage);
    };
  }, [storageKey]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 20_000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const savePreferences = (changes: Partial<Pick<QuoteSettings, "enabled" | "minutes">>) => {
    if (!storageKey) return false;
    try {
      const current = loadQuoteSettings(localStorage, storageKey);
      const next = { ...current, ...changes };
      next.nextAt = next.enabled ? Date.now() + next.minutes * 60_000 : 0;
      localStorage.setItem(storageKey, JSON.stringify(next));
      setState({ key: storageKey, settings: next });
      setMessage(null);
      setError(null);
      return true;
    } catch {
      setError("Your quote preference could not be saved. Please try again.");
      return false;
    }
  };

  return {
    enabled: state.key === storageKey ? state.settings.enabled : true,
    minutes: state.key === storageKey ? state.settings.minutes : 60,
    message: message?.key === storageKey ? message.text : null,
    dismiss: () => setMessage(null),
    translate: () => setMessage(current => current ? { ...current, text: translateQuote(current.text) } : null),
    setEnabled: (enabled: boolean) => savePreferences({ enabled }),
    setMinutes: (minutes: number) => {
      if (!validQuoteMinutes(minutes)) {
        setError("Choose a whole number from 1 to 1440 minutes.");
        return false;
      }
      return savePreferences({ minutes });
    },
    error,
  };
}
