import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { TooltipContent as Base } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
export { Tooltip, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
export const TooltipContent = forwardRef<
  ElementRef<typeof Base>,
  ComponentPropsWithoutRef<typeof Base>
>(({ className, ...props }, ref) => (
  <Base ref={ref} {...props} className={cn("admin-ui admin-popover", className)} />
));
TooltipContent.displayName = "AdminTooltipContent";
