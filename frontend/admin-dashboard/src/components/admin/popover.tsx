import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { PopoverContent as Base } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
export { Popover, PopoverTrigger, PopoverAnchor } from "@/components/ui/popover";
export const PopoverContent = forwardRef<
  ElementRef<typeof Base>,
  ComponentPropsWithoutRef<typeof Base>
>(({ className, ...props }, ref) => (
  <Base ref={ref} {...props} className={cn("admin-ui admin-popover", className)} />
));
PopoverContent.displayName = "AdminPopoverContent";
