import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User, Role } from "@/types";
import {
  changePassword as apiChangePassword,
  login as apiLogin,
  logout as apiLogout,
  me as apiMe,
  updateProfile as apiUpdateProfile,
} from "@/api/auth";
import {
  currentAuthGeneration,
  forgetAuthTokens,
  isAuthGenerationStale,
  refreshAuthIfNeeded,
  rememberAuthTokens,
} from "@/api/client";
import { advanceAuthGeneration } from "@/lib/auth-lifecycle";
import { shouldClearSavedSession } from "@/lib/auth-restore-policy";

/**
 * Startup session-restore status, distinct from `loading`.
 *
 * - `pending`   — `GET /auth/me` is still in flight (first paint / retry).
 * - `ready`     — restore finished (authenticated, or genuinely signed out).
 * - `error`     — a saved session exists but restore hit a transient failure
 *                 (offline / timeout / 5xx). The tokens are kept; the app must
 *                 offer recovery instead of forcing a re-login (W7).
 */
export type RestoreStatus = "pending" | "ready" | "error";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  loading: boolean;
  restoreStatus: RestoreStatus;
  retryRestore: () => void;
  login: (email: string, password: string, remember?: boolean) => Promise<User>;
  logout: () => Promise<void>;
  hasRole: (role: Role) => boolean;
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
  scopedTeamIds: () => string[] | undefined;
  refreshUser: () => Promise<User>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateProfile: (input: { name?: string; avatarUrl?: string | null }) => Promise<User>;
}

const AuthContext = createContext<AuthState | null>(null);
const STORAGE_KEY = "khaliduo.auth";

interface Persisted {
  user: User;
  accessToken: string;
  refreshToken: string;
}

function persistUser(user: User, accessToken: string, refreshToken: string) {
  const storage = localStorage.getItem(STORAGE_KEY) ? localStorage : sessionStorage;
  storage.setItem(STORAGE_KEY, JSON.stringify({ user, accessToken, refreshToken }));
  rememberAuthTokens({ accessToken, refreshToken }, storage);
}

function readPersisted(): Persisted | null {
  for (const storage of [localStorage, sessionStorage]) {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw) as Persisted;
      if (value.accessToken && value.refreshToken) {
        rememberAuthTokens(
          { accessToken: value.accessToken, refreshToken: value.refreshToken },
          storage,
        );
        return value;
      }
    } catch {
      storage.removeItem(STORAGE_KEY);
    }
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<{
    user: User | null;
    accessToken: string | null;
    refreshToken: string | null;
  }>({
    user: null,
    accessToken: null,
    refreshToken: null,
  });
  const [loading, setLoading] = useState(true);
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>("pending");
  // Bumping this re-runs the restore effect, giving the recovery UI a manual
  // "Try again" that reuses the saved tokens without a fresh login (W7).
  const [restoreNonce, setRestoreNonce] = useState(0);
  const retryRestore = useCallback(() => {
    setRestoreStatus("pending");
    setLoading(true);
    setRestoreNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    async function restore(attempt = 0) {
      // Bind this restore to the identity it started under so a logout while
      // /auth/me is in flight cannot later mark the app authenticated (W6).
      const generation = currentAuthGeneration();
      // Anchor this restore to the account it started under. A same-account token
      // rotation during /auth/me keeps this id; a different account being adopted
      // cross-tab changes it. Captured before the try so BOTH the success and the
      // error continuations can refuse to act on a superseded identity (W6).
      const parsed = typeof window !== "undefined" ? readPersisted() : null;
      const startedIdentity = parsed?.user?.id ?? null;
      const adoptedDifferentAccount = () => {
        const currentIdentity = readPersisted()?.user?.id ?? null;
        return (
          startedIdentity !== null &&
          currentIdentity !== null &&
          startedIdentity !== currentIdentity
        );
      };
      try {
        if (parsed) {
          const user = await apiMe();
          if (!cancelled && !isAuthGenerationStale(generation)) {
            // apiMe may have refreshed an expired access token. Re-read the
            // stored pair so the restore flow never overwrites fresh tokens
            // with the stale values captured before that request.
            const current = readPersisted() ?? parsed;
            // If a different account was adopted while /auth/me was in flight,
            // never pair this response's user with the newer account's tokens;
            // the storage handler has already applied the adopted session (W6).
            if (adoptedDifferentAccount()) {
              setRestoreStatus("ready");
              return;
            }
            persistUser(user, current.accessToken, current.refreshToken);
            setState({
              user,
              accessToken: current.accessToken,
              refreshToken: current.refreshToken,
            });
          }
        }
        if (!cancelled && !isAuthGenerationStale(generation)) setRestoreStatus("ready");
      } catch (error) {
        if (cancelled) return;
        // If a logout or account switch happened while this restore was in
        // flight, it belongs to a now-invalidated identity: never clear or
        // touch the current session on its behalf (W6).
        if (isAuthGenerationStale(generation)) return;
        // A cross-tab account switch does not advance the generation, so also
        // refuse to act when a different account now owns the store: a stale A
        // failure (even a genuine 401) must never clear B's newer login (W6).
        if (adoptedDifferentAccount()) {
          setRestoreStatus("ready");
          return;
        }
        if (shouldClearSavedSession(error)) {
          // The saved login is genuinely invalid or revoked.
          forgetAuthTokens();
          localStorage.removeItem(STORAGE_KEY);
          sessionStorage.removeItem(STORAGE_KEY);
          queryClient.getQueryCache().clear();
          setState({ user: null, accessToken: null, refreshToken: null });
          setRestoreStatus("ready");
        } else {
          // Transient network/server failure: keep the saved tokens so recovery
          // needs no re-login, and retry with backoff (W7). The cached account
          // is not presented as authorized until /auth/me actually succeeds, but
          // the app surfaces a recoverable state instead of bouncing to login.
          setState({ user: null, accessToken: null, refreshToken: null });
          setRestoreStatus("error");
          if (attempt < 5) {
            retryTimer = window.setTimeout(
              () => void restore(attempt + 1),
              Math.min(30_000, 1_000 * 2 ** attempt),
            );
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void restore();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [queryClient, restoreNonce]);

  useEffect(() => {
    if (!state.accessToken) return;
    let cancelled = false;
    const refreshInBackground = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      void refreshAuthIfNeeded().catch(() => {
        // The regular API request path remains the final recovery mechanism.
      });
    };
    refreshInBackground();
    const timer = window.setInterval(refreshInBackground, 60_000);
    const onVisible = () => refreshInBackground();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state.accessToken]);

  useEffect(() => {
    const onTokensRefreshed = (event: Event) => {
      const { accessToken, refreshToken } =
        (
          event as CustomEvent<{
            accessToken?: string;
            refreshToken?: string;
          }>
        ).detail ?? {};
      if (!accessToken || !refreshToken) return;
      const generation = currentAuthGeneration();
      setState((current) => ({ ...current, accessToken, refreshToken }));
      void apiMe(accessToken).then((user) => {
        // A logout may land between the refresh event and this resolution; do
        // not restore the user under a now-invalidated identity (W6).
        if (isAuthGenerationStale(generation)) return;
        // A cross-tab account switch does not advance the generation. Only
        // persist when the store still belongs to this same account: never pair
        // this refreshed user with a different account's adopted tokens, and
        // never recreate a store that a logout emptied (W6).
        const currentId = readPersisted()?.user?.id ?? null;
        if (currentId === null || currentId !== user.id) return;
        persistUser(user, accessToken, refreshToken);
        setState((current) => ({ ...current, user, accessToken, refreshToken }));
      });
    };
    const onSessionExpired = () => {
      queryClient.getQueryCache().clear();
      setState({ user: null, accessToken: null, refreshToken: null });
      // The session is definitively over (storage cleared). Settle the restore
      // state so the recovery screen — which promises the login "is still saved"
      // — is never shown over an emptied store; fall through to the login route
      // instead (W7).
      setRestoreStatus("ready");
    };
    const onAuthStorageChanged = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      if (event.newValue === null) {
        forgetAuthTokens();
        queryClient.getQueryCache().clear();
        setState({ user: null, accessToken: null, refreshToken: null });
        return;
      }
      try {
        const persisted = JSON.parse(event.newValue) as Persisted;
        if (!persisted.user || !persisted.accessToken || !persisted.refreshToken) return;
        const storage = event.storageArea ?? localStorage;
        rememberAuthTokens(
          { accessToken: persisted.accessToken, refreshToken: persisted.refreshToken },
          storage,
        );
        setState({
          user: persisted.user,
          accessToken: persisted.accessToken,
          refreshToken: persisted.refreshToken,
        });
      } catch {
        // Ignore a transient or unrelated malformed storage write. The next
        // authenticated request still validates the current server session.
      }
    };

    window.addEventListener("khaliduo:auth-refreshed", onTokensRefreshed);
    window.addEventListener("khaliduo:auth-expired", onSessionExpired);
    window.addEventListener("storage", onAuthStorageChanged);
    return () => {
      window.removeEventListener("khaliduo:auth-refreshed", onTokensRefreshed);
      window.removeEventListener("khaliduo:auth-expired", onSessionExpired);
      window.removeEventListener("storage", onAuthStorageChanged);
    };
  }, [queryClient]);

  const login = useCallback(
    async (email: string, password: string, remember = true) => {
      const res = await apiLogin(email, password);
      // Establishing a new session (including an account switch A→B) invalidates
      // any in-flight refresh/restore started under the previous identity, so a
      // late A callback cannot overwrite or delete B's credentials (W6).
      advanceAuthGeneration();
      queryClient.getQueryCache().clear();
      const payload: Persisted = {
        user: res.user,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      };
      const storage = remember ? localStorage : sessionStorage;
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
      rememberAuthTokens(
        { accessToken: payload.accessToken, refreshToken: payload.refreshToken },
        storage,
      );
      setState({ user: res.user, accessToken: res.accessToken, refreshToken: res.refreshToken });
      setRestoreStatus("ready");
      return res.user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await apiLogout(state.refreshToken);
    } finally {
      forgetAuthTokens();
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
      queryClient.getQueryCache().clear();
      setState({ user: null, accessToken: null, refreshToken: null });
    }
  }, [queryClient, state.refreshToken]);

  const refreshUser = useCallback(async () => {
    const user = await apiMe();
    setState((current) => {
      if (current.accessToken && current.refreshToken) {
        persistUser(user, current.accessToken, current.refreshToken);
      }
      return { ...current, user };
    });
    return user;
  }, []);

  const updateProfile = useCallback(
    async (input: { name?: string; avatarUrl?: string | null }) => {
      if (!state.accessToken) throw new Error("You are not signed in.");
      const user = await apiUpdateProfile(state.accessToken, input);
      setState((current) => {
        const next = { ...current, user };
        const storage = localStorage.getItem(STORAGE_KEY) ? localStorage : sessionStorage;
        if (next.accessToken && next.refreshToken) {
          storage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              user,
              accessToken: next.accessToken,
              refreshToken: next.refreshToken,
            }),
          );
        }
        return next;
      });
      return user;
    },
    [state.accessToken],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!state.accessToken) throw new Error("You are not signed in.");
      await apiChangePassword(state.accessToken, currentPassword, newPassword);
    },
    [state.accessToken],
  );

  const value = useMemo<AuthState>(
    () => ({
      ...state,
      loading,
      restoreStatus,
      retryRestore,
      login,
      logout,
      hasRole: (role) => state.user?.role === role,
      can: (permission) => state.user?.permissions.includes(permission) === true,
      canAny: (...required) =>
        required.some((permission) => state.user?.permissions.includes(permission) === true),
      scopedTeamIds: () =>
        state.user?.dataScope === "assigned_teams"
          ? state.user.teamLeadTeamIds.length
            ? state.user.teamLeadTeamIds
            : state.user.assignedTeamIds
          : undefined,
      refreshUser,
      changePassword,
      updateProfile,
    }),
    [
      state,
      loading,
      restoreStatus,
      retryRestore,
      login,
      logout,
      refreshUser,
      changePassword,
      updateProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
