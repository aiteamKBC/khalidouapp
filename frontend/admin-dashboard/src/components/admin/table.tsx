import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { Table as Base } from "@/components/ui/table";
import { cn } from "@/lib/utils";
export {
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
export const Table = forwardRef<ElementRef<typeof Base>, ComponentPropsWithoutRef<typeof Base>>(
  ({ className, ...props }, ref) => (
    <div className="admin-table-scroll">
      <Base ref={ref} {...props} className={cn("admin-table", className)} />
    </div>
  ),
);
Table.displayName = "AdminTable";
