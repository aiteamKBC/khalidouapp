import { createFileRoute, Link, Outlet, Navigate, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/lib/auth";
import { requiredPermissionForPath } from "@/lib/permissions";
import { ShieldX } from "lucide-react";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading, can } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (loading)
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  if (!user) return <Navigate to="/login" search={{ resetToken: undefined }} />;
  const requiredPermission = requiredPermissionForPath(pathname);
  if (requiredPermission && !can(requiredPermission)) {
    return (
      <AppShell>
        <div className="grid min-h-[70vh] place-items-center px-4 text-center">
          <div className="max-w-md">
            <ShieldX className="mx-auto h-12 w-12 text-muted-foreground" />
            <h1 className="mt-4 text-2xl font-semibold">Access denied</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You do not have permission to view this page. Ask an administrator if you need access.
            </p>
            <Link
              to="/profile"
              className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Go to my profile
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
