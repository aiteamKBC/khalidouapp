import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { SheetContent as Base } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
export const SheetContent = forwardRef<
  ElementRef<typeof Base>,
  ComponentPropsWithoutRef<typeof Base>
>(({ className, ...props }, ref) => (
  <Base ref={ref} {...props} className={cn("admin-ui admin-sheet", className)} />
));
SheetContent.displayName = "AdminSheetContent";
