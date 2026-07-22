import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User, Role } from "@/types";
import {
  changePassword as apiChangePassword,
  login as apiLogin,
  logout as apiLogout,
  me as apiMe,
  updateProfile as apiUpdateProfile,
} from "@/api/auth";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  loading: boolean;
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
}

function readPersisted(): Persisted | null {
  const raw = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Persisted;
    return value.accessToken && value.refreshToken ? value : null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
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

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const parsed = typeof window !== "undefined" ? readPersisted() : null;
        if (parsed) {
          const user = await apiMe();
          if (!cancelled) {
            // apiMe may have refreshed an expired access token. Re-read the
            // stored pair so the restore flow never overwrites fresh tokens
            // with the stale values captured before that request.
            const current = readPersisted() ?? parsed;
            persistUser(user, current.accessToken, current.refreshToken);
            setState({
              user,
              accessToken: current.accessToken,
              refreshToken: current.refreshToken,
            });
          }
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_KEY);
        if (!cancelled) setState({ user: null, accessToken: null, refreshToken: null });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

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
      setState((current) => ({ ...current, accessToken, refreshToken }));
      void apiMe(accessToken).then((user) => {
        persistUser(user, accessToken, refreshToken);
        setState((current) => ({ ...current, user, accessToken, refreshToken }));
      });
    };
    const onSessionExpired = () => {
      setState({ user: null, accessToken: null, refreshToken: null });
    };

    window.addEventListener("khaliduo:auth-refreshed", onTokensRefreshed);
    window.addEventListener("khaliduo:auth-expired", onSessionExpired);
    return () => {
      window.removeEventListener("khaliduo:auth-refreshed", onTokensRefreshed);
      window.removeEventListener("khaliduo:auth-expired", onSessionExpired);
    };
  }, []);

  const login = useCallback(async (email: string, password: string, remember = true) => {
    const res = await apiLogin(email, password);
    const payload: Persisted = {
      user: res.user,
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
    };
    (remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, JSON.stringify(payload));
    setState({ user: res.user, accessToken: res.accessToken, refreshToken: res.refreshToken });
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout(state.refreshToken);
    } finally {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
      setState({ user: null, accessToken: null, refreshToken: null });
    }
  }, [state.refreshToken]);

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
    [state, loading, login, logout, refreshUser, changePassword, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
