import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { TabsList as BaseList, TabsTrigger as BaseTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
export { Tabs, TabsContent } from "@/components/ui/tabs";
export const TabsList = forwardRef<
  ElementRef<typeof BaseList>,
  ComponentPropsWithoutRef<typeof BaseList>
>(({ className, ...props }, ref) => (
  <BaseList ref={ref} {...props} className={cn("admin-tabs-list", className)} />
));
TabsList.displayName = "AdminTabsList";
export const TabsTrigger = forwardRef<
  ElementRef<typeof BaseTrigger>,
  ComponentPropsWithoutRef<typeof BaseTrigger>
>(({ className, ...props }, ref) => (
  <BaseTrigger ref={ref} {...props} className={cn("admin-tabs-trigger", className)} />
));
TabsTrigger.displayName = "AdminTabsTrigger";
