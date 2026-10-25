import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  UserRoundCheck,
} from "lucide-react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { forgotPassword } from "@/api/auth";
import "./workspace-login.css";

type Props = {
  role: "admin" | "employee";
  pending: boolean;
  error?: string | null;
  onSubmit: (email: string, password: string, remember: boolean) => void;
};

export default function WorkspaceLogin({ role, pending, error, onSubmit }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [dark, setDark] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    try {
      setDark(localStorage.getItem("khaliduo-theme-v2") === "dark");
    } catch {
      /* storage is optional */
    }
  }, []);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function requestReset() {
    if (role === "employee") {
      setNotice("Contact your admin to reset your employee password.");
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setNotice("Enter your email address first.");
      return;
    }
    setSendingReset(true);
    try {
      await forgotPassword(email.trim());
      setCooldown(30);
      setNotice("If the account exists, a password reset link was emailed.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setSendingReset(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setNotice(null);
    onSubmit(email.trim(), password, remember);
  }

  return (
    <div className="workspace-login" data-theme={dark ? "dark" : "light"}>
      <picture className="login-background" aria-hidden="true">
        <source media="(max-width: 767px)" srcSet="/login-reception-mobile.png" />
        <img src="/login-reception-desktop.png" alt="" />
      </picture>
      <div className="login-scrim" aria-hidden="true" />
      <div className="login-layout">
        <header className="login-topbar">
          <a href={role === "admin" ? "/dashboard" : "/employee"}>
            <ArrowLeft aria-hidden="true" />
            Back to dashboard
          </a>
          <button
            type="button"
            className="login-theme"
            aria-pressed={dark}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => {
              setDark(!dark);
              try {
                localStorage.setItem("khaliduo-theme-v2", dark ? "light" : "dark");
              } catch {
                /* storage is optional */
              }
            }}
          >
            {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
        </header>
        <main className="login-main">
          <div className="login-content">
            <div className="login-brand">
              <span className="login-logo">
                <BrandLogo />
              </span>
              <span>
                <strong>KHALIDUO</strong>
                <small>TIME TRACKING SUITE</small>
              </span>
            </div>
            <div className="login-glass">
              <div className="login-card">
                <nav className="login-roles" aria-label="Sign in as">
                  <a href="/login" aria-current={role === "admin" ? "page" : undefined}>
                    <ShieldCheck aria-hidden="true" />
                    Admin
                  </a>
                  <a href="/app" aria-current={role === "employee" ? "page" : undefined}>
                    <UserRoundCheck aria-hidden="true" />
                    Employee
                  </a>
                </nav>
                <h1>Sign in to your account</h1>
                <p className="login-subtitle">
                  {role === "admin"
                    ? "Enter your admin credentials to continue."
                    : "Enter your employee credentials to open your shift."}
                </p>
                <form onSubmit={submit}>
                  <div className="login-field">
                    <label htmlFor="auth-email">Email</label>
                    <div className="login-input-wrap">
                      <Mail aria-hidden="true" />
                      <input
                        id="auth-email"
                        name="email"
                        type="email"
                        autoComplete="username"
                        autoCapitalize="none"
                        placeholder="you@company.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        disabled={pending}
                      />
                    </div>
                  </div>
                  <div className="login-field">
                    <div className="login-field-heading">
                      <label htmlFor="auth-password">Password</label>
                      <button
                        type="button"
                        onClick={() => void requestReset()}
                        disabled={pending || sendingReset || cooldown > 0}
                      >
                        {sendingReset
                          ? "Sending..."
                          : cooldown > 0
                            ? `Resend in ${cooldown}s`
                            : "Forgot password?"}
                      </button>
                    </div>
                    <div className="login-input-wrap">
                      <LockKeyhole aria-hidden="true" />
                      <input
                        id="auth-password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        disabled={pending}
                      />
                      <button
                        type="button"
                        className="login-password-toggle"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                      </button>
                    </div>
                  </div>
                  {role === "admin" ? (
                    <label className="login-remember">
                      <input
                        name="remember"
                        type="checkbox"
                        checked={remember}
                        onChange={(event) => setRemember(event.target.checked)}
                        disabled={pending}
                      />
                      Remember me on this device
                    </label>
                  ) : (
                    <p className="login-session-note">
                      Your employee session stays signed in in this browser tab.
                    </p>
                  )}
                  {error && (
                    <p className="login-error" role="alert">
                      {error}
                    </p>
                  )}
                  {notice && (
                    <p className="login-notice" role="status">
                      {notice}
                    </p>
                  )}
                  <button type="submit" className="login-submit" disabled={pending}>
                    {pending && <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />}
                    {pending ? "Signing in..." : "Sign in"}
                  </button>
                </form>
                <div className="login-download">
                  <a href="/download">
                    <Monitor aria-hidden="true" />
                    Download Khaliduo for Windows
                  </a>
                </div>
              </div>
            </div>
            <p className="login-caption">Khaliduo by Kent Consultancy</p>
          </div>
        </main>
        <footer className="login-footer">SECURED WORKSPACE · {new Date().getFullYear()}</footer>
      </div>
    </div>
  );
}
