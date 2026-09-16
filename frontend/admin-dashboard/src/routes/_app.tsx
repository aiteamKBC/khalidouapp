import { createFileRoute, Link, Outlet, Navigate, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { useAuth } from "@/lib/auth";
import { requiredPermissionForPath } from "@/lib/permissions";
import { Loader2, ShieldX, WifiOff } from "lucide-react";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading, restoreStatus, retryRestore, can } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex flex-col items-center gap-3 text-sm font-semibold text-muted-foreground">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </span>
          Loading your workspace...
        </div>
      </div>
    );
  }
  // A saved session that failed to restore for a transient reason (offline,
  // timeout, 5xx) keeps its tokens. Offer recovery in place instead of bouncing
  // to the login form, so a brief outage never forces re-entering credentials
  // (W7). Auto-retry continues in the background; this also gives a manual retry.
  if (!user && restoreStatus === "error") {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-4 text-center">
        <div className="max-w-md">
          <WifiOff className="mx-auto h-12 w-12 text-muted-foreground" />
          <h1 className="mt-4 text-2xl font-semibold">Can’t reach the server</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn’t restore your session because the server is unreachable. Your
            sign-in is still saved — this will retry automatically, or you can retry now.
            No need to sign in again.
          </p>
          <button
            type="button"
            onClick={retryRestore}
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" search={{ resetToken: undefined }} replace />;
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
