import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { BrandLogo } from "@/components/ui/brand-logo";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { forgotPassword, resetPassword } from "@/api/auth";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
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
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
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

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }
    setSubmitting(true);
    try {
      await login(email, password, remember);
      toast.success("Signed in");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid credentials");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-background flex">
      <div className="hidden lg:flex flex-1 flex-col bg-sidebar text-sidebar-foreground p-10 relative overflow-hidden">
        <div className="relative flex flex-1 flex-col items-center justify-center text-center">
          <div className="grid aspect-square w-[min(80%,28rem)] place-items-center rounded-[2rem] bg-white/95 p-10 shadow-2xl ring-1 ring-white/30">
            <BrandLogo className="h-full w-full" />
          </div>
          <div className="mt-8 text-4xl font-semibold tracking-tight">Khaliduo</div>
          <div className="mt-1 text-base text-sidebar-foreground/70">by Kent Consultancy</div>
          <h2 className="mt-6 max-w-sm text-lg font-medium leading-snug text-sidebar-foreground/90">
            Employee time tracking, simplified.
          </h2>
        </div>
        <div className="relative text-center text-xs text-sidebar-foreground/60">
          Kent Consultancy internal use only.
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden flex items-center gap-3">
            <BrandLogo className="h-11 w-11" />
            <div>
              <div className="text-lg font-semibold">Khaliduo</div>
              <div className="text-xs text-muted-foreground">by Kent Consultancy</div>
            </div>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">Sign in to your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your admin credentials to continue.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@kentbusinesscollege.com"
                required
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  onClick={async () => {
                    if (!email.includes("@")) {
                      toast.error("Enter your email first.");
                      return;
                    }
                    try {
                      await forgotPassword(email);
                      toast.success("If the account exists, a password reset link was emailed.");
                    } catch (error) {
                      toast.error(
                        error instanceof Error ? error.message : "Could not send reset email.",
                      );
                    }
                  }}
                  className="text-xs text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={remember} onCheckedChange={(value) => setRemember(!!value)} />
              <span className="text-muted-foreground">Remember me on this device</span>
            </label>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
          <a
            href="/employee"
            className="mt-5 block text-center text-sm text-primary hover:underline"
          >
            Employee dashboard
          </a>
          <a
            href="/download"
            className="mt-3 block text-center text-sm text-primary hover:underline"
          >
            Download Khaliduo for Windows
          </a>
        </div>
      </div>
    </div>
  );
}
