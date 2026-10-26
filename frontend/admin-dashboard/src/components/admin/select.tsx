import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { SelectContent as Base } from "@/components/ui/select";
import { cn } from "@/lib/utils";
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from "@/components/ui/select";
export const SelectContent = forwardRef<
  ElementRef<typeof Base>,
  ComponentPropsWithoutRef<typeof Base>
>(({ className, ...props }, ref) => (
  <Base ref={ref} {...props} className={cn("admin-ui admin-popover", className)} />
));
SelectContent.displayName = "AdminSelectContent";
