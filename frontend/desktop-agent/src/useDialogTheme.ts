import { useLayoutEffect } from "react";
import { appearanceVariables } from "../../shared/appearance-palettes";
import type { Appearance } from "../../shared/appearance-store";

// Dialogs live under body, outside the workspace that owns the theme tokens.
export function useDialogTheme({ skin, mode }: Appearance) {
  useLayoutEffect(() => {
    const body = document.body;
    const previousMode = body.getAttribute("data-dialog-theme");
    const previous = Object.entries(appearanceVariables({ skin, mode })).map(([name, value]) => {
      const key = name.replace("--k-", "--dialog-");
      const saved = body.style.getPropertyValue(key);
      body.style.setProperty(key, value);
      return [key, saved] as const;
    });
    body.setAttribute("data-dialog-theme", mode);
    return () => {
      for (const [key, value] of previous) {
        if (value) body.style.setProperty(key, value);
        else body.style.removeProperty(key);
      }
      if (previousMode) body.setAttribute("data-dialog-theme", previousMode);
      else body.removeAttribute("data-dialog-theme");
    };
  }, [skin, mode]);
}
