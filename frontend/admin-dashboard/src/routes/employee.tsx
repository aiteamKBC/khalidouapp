import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import EmployeeWorkspace from "@/components/employee-workspace/EmployeeWorkspace";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  clearEmployeeToken,
  employeeLogin,
  exchangeEmployeeHandoff,
  readEmployeeToken,
  saveEmployeeToken,
} from "@/api/employee-portal";

export const Route = createFileRoute("/employee")({ component: EmployeePortalPage });

function EmployeePortalPage() {
  const [token, setToken] = useState(() => readEmployeeToken());
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);

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
  const [email, setEmail] = useState("");
  const [credential, setCredential] = useState("");
  const emailValue = email.trim();
  const credentialValue = credential.trim();
  const login = useMutation({
    mutationFn: () => employeeLogin(emailValue, credentialValue),
    onSuccess: (result) => {
      queryClient.removeQueries({ queryKey: ["employee-portal"] });
      queryClient.removeQueries({ queryKey: ["protected-image", "employee"] });
      saveEmployeeToken(result.access_token);
      onLoggedIn(result.access_token);
    },
  });
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-5">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="items-center text-center">
          <BrandLogo className="mb-3 h-20 w-20 rounded-2xl" />
          <CardTitle className="text-2xl">Khaliduo Employee Portal</CardTitle>
          <p className="text-sm text-muted-foreground">Kent Consultancy</p>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            autoComplete="off"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              clearEmployeeToken();
              queryClient.removeQueries({ queryKey: ["employee-portal"] });
              queryClient.removeQueries({ queryKey: ["protected-image", "employee"] });
              if (!emailValue || !credentialValue) {
                return;
              }
              login.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="employee-email">Work email</Label>
              <Input
                id="employee-email"
                name="khaliduo-employee-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="employee-credential">Password</Label>
              <PasswordInput
                id="employee-credential"
                name="khaliduo-employee-credential"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Use the password you chose when accepting your email invitation, or the password
                your admin set for you.
              </p>
            </div>
            {login.error && <p className="text-sm text-destructive">{login.error.message}</p>}
            {initialError && <p className="text-sm text-destructive">{initialError}</p>}
            <Button
              className="w-full"
              type="submit"
              disabled={login.isPending || !emailValue || !credentialValue}
            >
              {login.isPending ? "Signing in..." : "Open my dashboard"}
            </Button>
            <a className="block text-center text-sm text-primary hover:underline" href="/download">
              Download Khaliduo for Windows
            </a>
            <a className="block text-center text-sm text-primary hover:underline" href="/login">
              Admin sign in
            </a>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
