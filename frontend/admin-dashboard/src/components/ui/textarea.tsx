import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[88px] w-full rounded-[10px] border border-input bg-card px-3 py-2 text-base shadow-sm transition-all placeholder:text-muted-foreground/80 hover:border-primary/20 focus-visible:border-primary/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/10 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
