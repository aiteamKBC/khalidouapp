import { useState } from "react";
import { CalendarIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDisplayDate, parseIsoDate as parseDate, toIsoDate as dateValue } from "@/lib/format";
import { cn } from "@/lib/utils";

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
            {selected ? formatDisplayDate(selected) : placeholder}
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
