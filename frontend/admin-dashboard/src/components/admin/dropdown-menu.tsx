import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { DropdownMenuContent as Base } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from "@/components/ui/dropdown-menu";
export const DropdownMenuContent = forwardRef<
  ElementRef<typeof Base>,
  ComponentPropsWithoutRef<typeof Base>
>(({ className, ...props }, ref) => (
  <Base ref={ref} {...props} className={cn("admin-ui admin-popover", className)} />
));
DropdownMenuContent.displayName = "AdminDropdownMenuContent";
