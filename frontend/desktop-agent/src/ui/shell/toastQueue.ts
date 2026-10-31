import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "success" | "warning" | "error";

export type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

const TOAST_LIFETIME = 3400;
const MAX_VISIBLE = 3;

/**
 * The Readdy design's stacked toast queue: each message is added on top of
 * the previous ones with its own tone and auto-dismiss timer; a repeated
 * message replaces its older copy.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<number[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = "success") => {
      const text = message.trim();
      if (!text) return;
      const id = nextId.current;
      nextId.current += 1;
      setToasts((previous) =>
        [...previous.filter((item) => item.message !== text), { id, message: text, tone }].slice(-MAX_VISIBLE),
      );
      timers.current.push(window.setTimeout(() => dismiss(id), TOAST_LIFETIME));
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current = [];
    },
    [],
  );

  return { toasts, push, dismiss };
}
