import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type NotePromptOptions = {
  title: string;
  description?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Defaults to true: submit is disabled until a non-empty note is entered. */
  required?: boolean;
};

/**
 * Replaces window.prompt() with a themed dialog. Renders `dialog` once in the
 * tree, then call `prompt(options)` anywhere (e.g. a button onClick) and
 * await the trimmed note, or null if the admin cancelled.
 */
export function useNotePrompt() {
  const [options, setOptions] = useState<NotePromptOptions | null>(null);
  const [value, setValue] = useState("");
  const resolverRef = useRef<((note: string | null) => void) | null>(null);

  const prompt = useCallback((next: NotePromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
      setValue("");
      setOptions(next);
    });
  }, []);

  const resolve = (note: string | null) => {
    resolverRef.current?.(note);
    resolverRef.current = null;
    setOptions(null);
  };

  const required = options?.required !== false;

  const dialog = (
    <Dialog open={options !== null} onOpenChange={(open) => !open && resolve(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{options?.title}</DialogTitle>
          {options?.description && <DialogDescription>{options.description}</DialogDescription>}
        </DialogHeader>
        <Textarea
          autoFocus
          rows={3}
          value={value}
          placeholder={options?.placeholder}
          onChange={(event) => setValue(event.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => resolve(null)}>
            Cancel
          </Button>
          <Button disabled={required && !value.trim()} onClick={() => resolve(value.trim())}>
            {options?.confirmLabel ?? "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { prompt, dialog };
}
