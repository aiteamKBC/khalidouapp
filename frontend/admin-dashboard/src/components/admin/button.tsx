import { forwardRef } from "react";
import { Button as BaseButton, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
export { buttonVariants } from "@/components/ui/button";
export type { ButtonProps } from "@/components/ui/button";
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <BaseButton
      ref={ref}
      {...props}
      variant={variant}
      className={cn("admin-button", className)}
      data-admin-variant={variant}
    />
  ),
);
Button.displayName = "AdminButton";
