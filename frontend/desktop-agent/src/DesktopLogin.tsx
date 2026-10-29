import { useState, type FormEvent, type ReactNode } from "react";
import { NativeWindowControls } from "./NativeWindowControls";
import "./workspace-login.css";
import "./DesktopLogin.css";

const ICONS = {
  mail: "M3 5h18v14H3zM3 5l9 7 9-7",
  lock: "M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3M12 14v3",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  eyeOff:
    "M3 3l18 18M10 5c7-1 12 7 12 7a20 20 0 0 1-4 4M6 6a20 20 0 0 0-4 6s4 7 10 7c2 0 4-1 5-2M10 10a3 3 0 0 0 4 4",
  shield: "M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6zM8 12l3 3 5-6",
  sun: "M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  moon: "M20 15a9 9 0 0 1-11-11A9 9 0 1 0 20 15",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2",
};

function LoginIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

export default function DesktopLogin({
  employeeEmail,
  employeePassword,
  enrollmentError,
  isSubmitting,
  isDesktopRuntime,
  onEmailChange,
  onPasswordChange,
  onCredentialEnrollment,
  theme,
  onThemeChange,
  updateNotice,
  version,
}: {
  employeeEmail: string;
  employeePassword: string;
  enrollmentError: string | null;
  isSubmitting: boolean;
  isDesktopRuntime: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onCredentialEnrollment: (event: FormEvent<HTMLFormElement>) => void;
  theme: "light" | "dark";
  onThemeChange: () => void;
  updateNotice?: ReactNode;
  version?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState(false);
  return (
    <div className="workspace-login desktop-login" data-theme={theme}>
      <picture className="login-background" aria-hidden="true">
        <source
          media="(max-width: 767px)"
          srcSet="./login-reception-mobile.png"
        />
        <img src="./login-reception-desktop.png" alt="" />
      </picture>
      <div className="login-scrim" aria-hidden="true" />
      <div className="login-layout">
        <header className="login-topbar">
          <span className="login-desktop-label">KHALIDUO FOR WINDOWS</span>
          <div className="login-titlebar-actions">
            <button
              type="button"
              className="login-theme"
              aria-pressed={theme === "dark"}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              onClick={onThemeChange}
            >
              <LoginIcon name={theme === "dark" ? "sun" : "moon"} />
            </button>
            <NativeWindowControls />
          </div>
        </header>
        {updateNotice}
        <main className="login-main">
          <div className="login-content">
            <div className="login-brand">
              <span className="login-logo">
                <img src="./khaliduo-icon.png" alt="Khaliduo" />
              </span>
              <span>
                <strong>KHALIDUO</strong>
                <small>TIME TRACKING SUITE</small>
              </span>
            </div>
            <div className="login-glass">
              <div className="login-card">
                <div className="login-desktop-role">
                  <LoginIcon name="shield" />
                  Employee workspace
                </div>
                <h1>Sign in to your account</h1>
                <p className="login-subtitle">
                  <LoginIcon name="clock" />
                  Enter your employee credentials to open your shift.
                </p>
                <form
                  onSubmit={onCredentialEnrollment}
                  aria-busy={isSubmitting}
                >
                  <div className="login-field">
                    <label htmlFor="desktop-auth-email">Work email</label>
                    <div className="login-input-wrap">
                      <LoginIcon name="mail" />
                      <input
                        id="desktop-auth-email"
                        name="email"
                        type="email"
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="you@company.com"
                        value={employeeEmail}
                        onChange={(event) => onEmailChange(event.target.value)}
                        required
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>
                  <div className="login-field">
                    <div className="login-field-heading">
                      <label htmlFor="desktop-auth-password">Password</label>
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => setNotice(true)}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="login-input-wrap">
                      <LoginIcon name="lock" />
                      <input
                        id="desktop-auth-password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={employeePassword}
                        onChange={(event) =>
                          onPasswordChange(event.target.value)
                        }
                        required
                        minLength={8}
                        disabled={isSubmitting}
                      />
                      <button
                        type="button"
                        className="login-password-toggle"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword((value) => !value)}
                      >
                        <LoginIcon name={showPassword ? "eyeOff" : "eye"} />
                      </button>
                    </div>
                  </div>
                  <p className="login-session-note">
                    This computer will be securely linked to your employee
                    account.
                  </p>
                  {enrollmentError ? (
                    <p className="login-error" role="alert">
                      {enrollmentError}
                    </p>
                  ) : null}
                  {notice ? (
                    <p className="login-notice" role="status">
                      Contact your admin to reset your employee password.
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    className="login-submit"
                    disabled={isSubmitting || !isDesktopRuntime}
                  >
                    {isSubmitting ? (
                      <span className="login-spinner" aria-hidden="true" />
                    ) : null}
                    {isSubmitting ? "Signing in..." : "Sign in"}
                  </button>
                </form>
                <div className="login-desktop-security">
                  <LoginIcon name="shield" />
                  <span>Secure employee sign-in</span>
                </div>
              </div>
            </div>
            <p className="login-caption">Khaliduo by Kent Consultancy</p>
          </div>
        </main>
        <footer className="login-footer">
          SECURED WORKSPACE · {new Date().getFullYear()}
          {version ? ` · v${version}` : ""}
        </footer>
      </div>
    </div>
  );
}
