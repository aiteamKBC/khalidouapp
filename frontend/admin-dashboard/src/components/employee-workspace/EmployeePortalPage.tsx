import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import EmployeeWorkspace from "@/components/employee-workspace/EmployeeWorkspace";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Card } from "@/components/ui/card";
import WorkspaceLogin, { type LoginRole } from "@/components/auth/WorkspaceLogin";
import {
  clearEmployeeToken,
  employeeLogin,
  exchangeEmployeeHandoff,
  readEmployeeToken,
  saveEmployeeToken,
} from "@/api/employee-portal";

export default function EmployeePortalPage({
  initialMode = "dashboard",
}: { initialMode?: "dashboard" | "tracker" } = {}) {
  const [token, setToken] = useState<string | null>(null);
  const [restoringSession, setRestoringSession] = useState(true);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

  useEffect(() => {
    setToken(readEmployeeToken());
    setRestoringSession(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handoffToken = new URLSearchParams(window.location.search).get("handoff");
    if (!handoffToken) return;

    setHandoffLoading(true);
    void exchangeEmployeeHandoff(handoffToken)
      .then((result) => {
        saveEmployeeToken(result.access_token);
        setToken(result.access_token);
        const target = new URL(window.location.href);
        target.searchParams.delete("handoff");
        window.history.replaceState({}, "", `${target.pathname}${target.search}`);
      })
      .catch((error: unknown) => {
        setHandoffError(error instanceof Error ? error.message : "The dashboard link expired.");
        const target = new URL(window.location.href);
        target.searchParams.delete("handoff");
        window.history.replaceState({}, "", `${target.pathname}${target.search}`);
      })
      .finally(() => setHandoffLoading(false));
  }, [token]);

  if (restoringSession) {
    return (
      <main className="grid min-h-screen place-items-center bg-background">
        <span
          role="status"
          aria-label="Loading your workspace"
          className="size-10 rounded-full border-[3px] border-primary/20 border-t-primary motion-safe:animate-spin"
        />
      </main>
    );
  }
  if (!token && handoffLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40 p-5">
        <Card className="w-full max-w-md p-8 text-center shadow-xl">
          <BrandLogo className="mx-auto mb-4 h-20 w-20 rounded-2xl" />
          <h1 className="text-xl font-semibold">Opening your Khaliduo dashboard...</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Securely signing in from the desktop app.
          </p>
        </Card>
      </main>
    );
  }
  if (!token) return <EmployeeLogin onLoggedIn={setToken} initialError={handoffError} />;
  return (
    <EmployeeWorkspace
      initialMode={initialMode}
      token={token}
      onLogout={() => {
        clearEmployeeToken();
        setToken(null);
      }}
    />
  );
}

function EmployeeLogin({
  onLoggedIn,
  initialError,
}: {
  onLoggedIn: (token: string) => void;
  initialError?: string | null;
}) {
  const queryClient = useQueryClient();
  const { login: adminLogin } = useAuth();
  const navigate = useNavigate();
  const login = useMutation({
    mutationFn: async ({
      email,
      password,
      remember,
      role,
    }: {
      email: string;
      password: string;
      remember: boolean;
      role: LoginRole;
    }) => {
      if (role === "admin") {
        await adminLogin(email, password, remember);
        return null;
      }
      return employeeLogin(email, password);
    },
    onSuccess: (result) => {
      if (!result) {
        void navigate({ to: "/dashboard", replace: true });
        return;
      }
      queryClient.removeQueries({ queryKey: ["employee-portal"] });
      queryClient.removeQueries({ queryKey: ["protected-image", "employee"] });
      saveEmployeeToken(result.access_token);
      onLoggedIn(result.access_token);
    },
  });
  return (
    <WorkspaceLogin
      role="employee"
      pending={login.isPending}
      error={login.error?.message ?? initialError}
      onSubmit={(email, password, remember, role) => {
        if (role === "employee") {
          clearEmployeeToken();
          queryClient.removeQueries({ queryKey: ["employee-portal"] });
          queryClient.removeQueries({ queryKey: ["protected-image", "employee"] });
        }
        login.mutate({ email, password, remember, role });
      }}
    />
  );
}
