import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/ui/brand-logo";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { resetPassword } from "@/api/auth";
import WorkspaceLogin from "@/components/auth/WorkspaceLogin";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    resetToken:
      typeof search.resetToken === "string" && search.resetToken ? search.resetToken : undefined,
  }),
  component: LoginPage,
});

function LoginPage() {
  const { login, user } = useAuth();
  const { resetToken } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/dashboard" replace />;

  async function onResetSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(resetToken!, password);
      toast.success("Password updated. You can sign in now.");
      setPassword("");
      setConfirmPassword("");
      void navigate({ to: "/login", search: { resetToken: undefined }, replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setSubmitting(false);
    }
  }

  if (resetToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
          <BrandLogo className="mb-5 h-12 w-12" />
          <h1 className="text-2xl font-semibold">Set a new password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This reset link can be used once and expires automatically.
          </p>
          <form onSubmit={onResetSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <PasswordInput
                id="new-password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <PasswordInput
                id="confirm-password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Updating..." : "Update password"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  async function onSubmit(email: string, password: string, remember: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, remember);
      toast.success("Signed in");
      void navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid credentials");
    } finally {
      setSubmitting(false);
    }
  }

  return <WorkspaceLogin role="admin" pending={submitting} error={error} onSubmit={onSubmit} />;
}
