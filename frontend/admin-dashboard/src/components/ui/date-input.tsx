import * as React from "react";
import { CalendarIcon } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isoDateToDisplay, parseIsoDate, toIsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type DateInputProps = Omit<React.ComponentProps<"input">, "type" | "value" | "onChange"> & {
  /** ISO `YYYY-MM-DD`, or "" when empty — the same contract as a native date input. */
  value: string;
  min?: string;
  max?: string;
  onChange: (event: { target: { value: string } }) => void;
};

// Digits typed so far, re-slashed as dd/mm/yyyy.
function maskDigits(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function displayToIso(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = parseIsoDate(iso);
  return date && toIsoDate(date) === iso ? iso : null;
}

function withinRange(iso: string, min?: string, max?: string) {
  return (!min || iso >= min) && (!max || iso <= max);
}

/**
 * Date field that always reads and types as dd/mm/yyyy, whatever the browser
 * locale. A native `<input type="date">` follows the device's language, so the
 * same page showed mm/dd/yyyy on some machines. Drop-in for `<Input type="date">`.
 */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, min, max, onChange, onBlur, disabled, placeholder = "dd/mm/yyyy", ...props },
  ref,
) {
  const [text, setText] = React.useState(() => isoDateToDisplay(value));
  const [open, setOpen] = React.useState(false);
  const emitted = React.useRef(value ?? "");

  React.useEffect(() => {
    if ((value ?? "") === emitted.current) return;
    emitted.current = value ?? "";
    setText(isoDateToDisplay(value));
  }, [value]);

  const emit = (next: string) => {
    emitted.current = next;
    onChange({ target: { value: next } });
  };

  const selected = parseIsoDate(value);
  const minimum = parseIsoDate(min);
  const maximum = parseIsoDate(max);
  const currentYear = new Date().getFullYear();

  return (
    <div className="relative w-full">
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        className="pr-10"
        onChange={(event) => {
          const masked = maskDigits(event.target.value);
          setText(masked);
          if (!masked) {
            emit("");
            return;
          }
          const iso = displayToIso(masked);
          if (iso && withinRange(iso, min, max)) emit(iso);
        }}
        onBlur={(event) => {
          // An unfinished or out-of-range entry falls back to the last valid date.
          const iso = displayToIso(text);
          if (text && !(iso && withinRange(iso, min, max))) setText(isoDateToDisplay(value));
          onBlur?.(event);
        }}
        {...props}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Open calendar"
            className={cn(
              "absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="z-[70] w-auto p-0" align="end" sideOffset={6}>
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? maximum ?? minimum ?? new Date()}
            captionLayout="dropdown"
            startMonth={minimum ?? new Date(currentYear - 70, 0)}
            endMonth={maximum ?? new Date(currentYear + 10, 11)}
            disabled={[
              ...(minimum ? [{ before: minimum }] : []),
              ...(maximum ? [{ after: maximum }] : []),
            ]}
            onSelect={(date) => {
              if (!date) return;
              const iso = toIsoDate(date);
              setText(isoDateToDisplay(iso));
              emit(iso);
              setOpen(false);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
});
