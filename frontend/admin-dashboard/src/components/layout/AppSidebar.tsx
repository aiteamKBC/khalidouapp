import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  UsersRound,
  BriefcaseBusiness,
  Camera,
  Clock,
  ClockPlus,
  Banknote,
  MonitorSmartphone,
  BarChart3,
  Settings,
  ScrollText,
  LogOut,
  Bell,
  CircleUserRound,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { BrandLogo } from "@/components/ui/brand-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

import { cn } from "@/lib/utils";
import type { Role } from "@/types";
import type { LucideIcon } from "lucide-react";
import { permissions, type PermissionKey } from "@/lib/permissions";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
  permission?: PermissionKey;
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Monitor",
    items: [
      {
        to: "/dashboard",
        label: "Overview",
        icon: LayoutDashboard,
        permission: permissions.dashboardView,
      },
      { to: "/teams", label: "Teams", icon: Users, permission: permissions.teamsView },
      { to: "/people", label: "People", icon: UsersRound, permission: permissions.peopleView },
      {
        to: "/projects",
        label: "Projects & Tasks",
        icon: BriefcaseBusiness,
        permission: permissions.projectsView,
      },
    ],
  },
  {
    label: "Tracking",
    items: [
      {
        to: "/screenshots",
        label: "Screenshots",
        icon: Camera,
        permission: permissions.screenshotsView,
      },
      {
        to: "/timesheets",
        label: "Timesheets",
        icon: Clock,
        permission: permissions.timesheetsView,
      },
      {
        to: "/time-adjustments",
        label: "Time Requests",
        icon: ClockPlus,
        permission: permissions.timeRequestsView,
      },
      { to: "/reports", label: "Reports", icon: BarChart3, permission: permissions.reportsView },
    ],
  },
  {
    label: "Manage",
    items: [
      { to: "/payroll", label: "Payroll", icon: Banknote, permission: permissions.payrollView },
      {
        to: "/devices",
        label: "Devices",
        icon: MonitorSmartphone,
        permission: permissions.devicesView,
      },
      {
        to: "/notifications",
        label: "Notifications",
        icon: Bell,
        permission: permissions.notificationsView,
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        to: "/settings/tracking",
        label: "Tracking Settings",
        icon: Settings,
        permission: permissions.settingsView,
      },
      { to: "/audit-log", label: "Audit Log", icon: ScrollText, permission: permissions.auditView },
      { to: "/profile", label: "My Profile", icon: CircleUserRound },
    ],
  },
];

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout, can } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (!item.roles || (user && item.roles.includes(user.role))) &&
          (!item.permission || can(item.permission)),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="flex h-full w-[250px] flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 px-4 pb-3 pt-5">
        <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white p-0.5 shadow-lg">
          <BrandLogo className="h-full w-full" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-extrabold leading-tight text-white">
            Khaliduo
          </div>
          <div className="truncate text-[11px] font-semibold text-sidebar-foreground">
            Kent Consultancy
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-2">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            <p className="px-2 pb-1 pt-3.5 text-[10px] font-extrabold uppercase tracking-[0.09em] text-white/30">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  pathname === item.to ||
                  (item.to !== "/dashboard" && pathname.startsWith(item.to)) ||
                  (item.to === "/people" &&
                    (pathname.startsWith("/employees") || pathname.startsWith("/live-activity")));
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      className={cn(
                        "relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold transition-colors",
                        active
                          ? "bg-[#4b1d52] text-white before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-full before:bg-[#e5185d]"
                          : "text-sidebar-foreground hover:bg-white/[0.07] hover:text-white",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.08] p-3">
        <div className="mb-2 flex items-center justify-between rounded-[10px] bg-white/[0.04] px-2.5 py-2">
          <span className="text-[11px] font-semibold text-sidebar-foreground">Appearance</span>
          <ThemeToggle className="h-8 w-8 border-white/10 bg-white/[0.06] text-sidebar-foreground hover:bg-white/10" />
        </div>
        {user && (
          <div className="flex items-center gap-2.5 px-1.5 py-1">
            <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#e5185d] to-violet-600 text-[11px] font-extrabold text-white">
              {user.name
                .split(" ")
                .map((word) => word[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
            <div className="min-w-0 flex-1 text-[10.5px] text-sidebar-foreground">
              <div className="truncate text-[12.5px] font-bold leading-tight text-white">
                {user.name}
              </div>
              <div className="truncate font-semibold">
                {user.role === "team_owner"
                  ? "Team lead"
                  : user.role === "hr"
                    ? "HR"
                    : "General admin"}
                {user.role === "general_admin" && user.teamLeadTeamIds.length > 0
                  ? " · Team lead"
                  : ""}
              </div>
            </div>
            <button
              onClick={() => logout()}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sidebar-foreground hover:bg-white/[0.08] hover:text-white"
              aria-label="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
