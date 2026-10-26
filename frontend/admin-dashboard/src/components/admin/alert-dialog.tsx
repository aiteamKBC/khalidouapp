import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { AlertDialogContent as Base } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
export const AlertDialogContent = forwardRef<
  ElementRef<typeof Base>,
  ComponentPropsWithoutRef<typeof Base>
>(({ className, ...props }, ref) => (
  <Base ref={ref} {...props} className={cn("admin-ui admin-dialog", className)} />
));
AlertDialogContent.displayName = "AdminAlertDialogContent";
