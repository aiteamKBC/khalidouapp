import { createFileRoute } from "@tanstack/react-router";
import EmployeePortalPage from "@/components/employee-workspace/EmployeePortalPage";
export const Route = createFileRoute("/employee")({ component: EmployeePortalPage });
