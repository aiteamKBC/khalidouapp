import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { DialogContent as Base } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export const DialogContent = forwardRef<
  ElementRef<typeof Base>,
  ComponentPropsWithoutRef<typeof Base>
>(({ className, ...props }, ref) => (
  <Base ref={ref} {...props} className={cn("admin-ui admin-dialog", className)} />
));
DialogContent.displayName = "AdminDialogContent";
