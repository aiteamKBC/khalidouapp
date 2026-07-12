import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function parseDate(value?: string | null) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function dateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DatePicker({
  value,
  onChange,
  minDate,
  placeholder = "Pick a date",
  clearable = true,
  disabled = false,
  className,
}: {
  value?: string | null;
  onChange: (value: string | null) => void;
  minDate?: string | null;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDate(value);
  const minimum = parseDate(minDate);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-start gap-2 px-3 text-left font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {selected ? format(selected, "MMM d, yyyy") : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-[70] w-auto p-0" align="start" sideOffset={6}>
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? minimum ?? new Date()}
          captionLayout="dropdown"
          startMonth={new Date(new Date().getFullYear() - 3, 0)}
          endMonth={new Date(new Date().getFullYear() + 8, 11)}
          disabled={minimum ? { before: minimum } : undefined}
          onSelect={(date) => {
            if (!date) return;
            onChange(dateValue(date));
            setOpen(false);
          }}
          initialFocus
        />
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={Boolean(minimum && new Date() < minimum)}
            onClick={() => {
              onChange(dateValue(new Date()));
              setOpen(false);
            }}
          >
            Today
          </Button>
          {clearable && value && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <X className="mr-1 h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
