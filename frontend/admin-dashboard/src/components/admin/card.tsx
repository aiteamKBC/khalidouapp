import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as Base from "@/components/ui/card";
import { cn } from "@/lib/utils";
export { CardFooter, CardDescription } from "@/components/ui/card";
export const Card = forwardRef<
  ElementRef<typeof Base.Card>,
  ComponentPropsWithoutRef<typeof Base.Card>
>(({ className, ...props }, ref) => (
  <Base.Card ref={ref} {...props} className={cn("admin-card", className)} />
));
Card.displayName = "AdminCard";
export const CardHeader = forwardRef<
  ElementRef<typeof Base.CardHeader>,
  ComponentPropsWithoutRef<typeof Base.CardHeader>
>(({ className, ...props }, ref) => (
  <Base.CardHeader ref={ref} {...props} className={cn("admin-card-header", className)} />
));
CardHeader.displayName = "AdminCardHeader";
export const CardTitle = forwardRef<
  ElementRef<typeof Base.CardTitle>,
  ComponentPropsWithoutRef<typeof Base.CardTitle>
>(({ className, ...props }, ref) => (
  <Base.CardTitle ref={ref} {...props} className={cn("admin-card-title", className)} />
));
CardTitle.displayName = "AdminCardTitle";
export const CardContent = forwardRef<
  ElementRef<typeof Base.CardContent>,
  ComponentPropsWithoutRef<typeof Base.CardContent>
>(({ className, ...props }, ref) => (
  <Base.CardContent ref={ref} {...props} className={cn("admin-card-content", className)} />
));
CardContent.displayName = "AdminCardContent";
