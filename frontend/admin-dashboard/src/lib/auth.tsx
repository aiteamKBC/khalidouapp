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
  scopedTeamIds: () => string[] | undefined;
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
    try {
      const raw =
        typeof window !== "undefined"
          ? (localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY))
          : null;
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        setState({
          user: parsed.user,
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
        });
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
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
      scopedTeamIds: () =>
        state.user?.role === "team_owner" ? state.user.assignedTeamIds : undefined,
      changePassword,
      updateProfile,
    }),
    [state, loading, login, logout, changePassword, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
