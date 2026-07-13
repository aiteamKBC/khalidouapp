import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  UsersRound,
  BriefcaseBusiness,
  Camera,
  Clock,
  ClockPlus,
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

const items: NavItem[] = [
  {
    to: "/dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    permission: permissions.dashboardView,
  },
  { to: "/teams", label: "Teams", icon: Users, permission: permissions.teamsView },
  {
    to: "/projects",
    label: "Projects & Tasks",
    icon: BriefcaseBusiness,
    permission: permissions.projectsView,
  },
  {
    to: "/notifications",
    label: "Notifications",
    icon: Bell,
    permission: permissions.notificationsView,
  },
  { to: "/profile", label: "My Profile", icon: CircleUserRound },
  { to: "/people", label: "People", icon: UsersRound, permission: permissions.peopleView },
  {
    to: "/screenshots",
    label: "Screenshots",
    icon: Camera,
    permission: permissions.screenshotsView,
  },
  { to: "/timesheets", label: "Timesheets", icon: Clock, permission: permissions.timesheetsView },
  {
    to: "/time-adjustments",
    label: "Time Requests",
    icon: ClockPlus,
    permission: permissions.timeRequestsView,
  },
  {
    to: "/devices",
    label: "Devices",
    icon: MonitorSmartphone,
    permission: permissions.devicesView,
  },
  { to: "/reports", label: "Reports", icon: BarChart3, permission: permissions.reportsView },
  {
    to: "/settings/tracking",
    label: "Tracking Settings",
    icon: Settings,
    permission: permissions.settingsView,
  },
  { to: "/audit-log", label: "Audit Log", icon: ScrollText, permission: permissions.auditView },
];

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout, can } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visible = items.filter(
    (item) =>
      (!item.roles || (user && item.roles.includes(user.role))) &&
      (!item.permission || can(item.permission)),
  );

  return (
    <aside className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/95 p-1 shadow-sm ring-1 ring-white/20">
          <BrandLogo className="h-full w-full" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Khaliduo</div>
          <div className="truncate text-[11px] text-sidebar-foreground/70">Kent Consultancy</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {visible.map((item) => {
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
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-sidebar-border px-3 py-3">
        {user && (
          <div className="mb-2 rounded-md px-3 py-2 text-xs text-sidebar-foreground/80">
            <div className="font-medium text-sidebar-foreground truncate">{user.name}</div>
            <div className="truncate">
              {user.role === "team_owner" ? "Team lead" : "General admin"}
              {user.role === "general_admin" && user.teamLeadTeamIds.length > 0
                ? " · Team lead"
                : ""}
            </div>
          </div>
        )}
        <button
          onClick={() => logout()}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </aside>
  );
}
