import { Moon, Sun } from "lucide-react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { useEffect, useRef, useState } from "react";
import type { Employee, Notification } from "@/components/employee-workspace/model";

type Props = {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenTracker: () => void;
  employee: Employee;
  notifications: Notification[];
  unreadCount: number;
  shiftLabel: string;
  trackingActive: boolean;
  onOpenProfile: () => void;
  onOpenQuotes: () => void;
  onDownloadApp: () => void;
  onLogout: () => void;
  onMarkAllRead: () => void;
  onOpenNotification: (id: string) => void;
};

export default function Header({
  theme,
  onToggleTheme,
  onOpenTracker,
  employee,
  notifications,
  unreadCount,
  shiftLabel,
  trackingActive,
  onOpenProfile,
  onOpenQuotes,
  onDownloadApp,
  onLogout,
  onMarkAllRead,
  onOpenNotification,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) setMenuOpen(false);
      if (bellRef.current && !bellRef.current.contains(target)) setBellOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setBellOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <header className="sticky top-0 z-40">
      <div className="border-b border-ew-line bg-ew-card">
        <div className="mx-auto flex h-[70px] w-full max-w-[1400px] items-center gap-3 px-4 md:px-6">
          <a href="#main" className="flex items-center gap-2.5 no-underline">
            <BrandLogo className="h-[58px] w-[49px]" />
            <span className="flex flex-col leading-none">
              <span className="font-ew-mono text-[12.5px] font-medium tracking-[0.18em] text-ew-plum">
                KHALIDUO
              </span>
              <span className="mt-1 hidden text-[10.5px] font-medium tracking-[0.06em] text-ew-muted sm:block">
                Employee workspace
              </span>
            </span>
          </a>

          <div className="ml-auto flex items-center gap-1.5 md:gap-2">
            <div className="mr-1 hidden items-center gap-2 rounded-full border border-ew-line bg-ew-bg-2 px-2.5 py-1.5 lg:flex">
              <span className="relative flex h-2 w-2 items-center justify-center">
                <span
                  className={`h-2 w-2 rounded-full ${trackingActive ? "bg-ew-ok" : "bg-ew-dot"}`}
                  aria-hidden="true"
                />
              </span>
              <span className="text-[11.5px] font-semibold text-ew-ink-2">
                {trackingActive ? "Paid shift active" : "Tracking paused"}
              </span>
              <span className="k-mono text-[10.5px] text-ew-muted">{shiftLabel}</span>
            </div>

            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              aria-pressed={theme === "dark"}
              className="grid h-9 w-9 place-items-center rounded-md border border-ew-line text-ew-muted"
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <button
              type="button"
              onClick={onOpenTracker}
              className="hidden rounded-md border border-ew-line px-3 py-2 text-xs font-semibold text-ew-plum sm:block"
            >
              Tracker
            </button>
            <div className="relative" ref={bellRef}>
              <button
                type="button"
                aria-label={`Notifications, ${unreadCount} unread`}
                aria-expanded={bellOpen}
                aria-haspopup="dialog"
                onClick={() => {
                  setBellOpen((v) => !v);
                  setMenuOpen(false);
                }}
                className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-ew-line text-ew-ink-2 transition-colors hover:bg-ew-bg-2"
              >
                <span className="flex h-[18px] w-[18px] items-center justify-center">
                  <WorkspaceIcon
                    className="ri-notification-3-line text-[17px]"
                    aria-hidden="true"
                  />
                </span>
                {unreadCount > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ew-pink px-1 font-ew-mono text-[9.5px] font-semibold text-white">
                    {unreadCount}
                  </span>
                ) : null}
              </button>

              {bellOpen ? (
                <div
                  className="k-pop absolute right-0 top-[calc(100%+8px)] z-50 w-[320px] overflow-hidden rounded-xl border border-ew-line bg-ew-card"
                  role="dialog"
                  aria-label="Notifications"
                >
                  <div className="flex items-center justify-between border-b border-ew-line px-3.5 py-2.5">
                    <p className="k-label">Notifications</p>
                    <button
                      type="button"
                      onClick={onMarkAllRead}
                      className="cursor-pointer font-ew-mono text-[10px] uppercase tracking-[0.08em] text-ew-pink hover:underline"
                    >
                      Mark all read
                    </button>
                  </div>
                  <ul className="max-h-[300px] overflow-y-auto">
                    {notifications.map((item) => (
                      <li key={item.id} className="border-b border-ew-line-2 last:border-b-0">
                        <button
                          type="button"
                          onClick={() => onOpenNotification(item.id)}
                          className="flex w-full cursor-pointer items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-ew-bg-2"
                        >
                          <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md bg-ew-pink-2 text-ew-pink">
                            <WorkspaceIcon
                              className={`${item.icon} text-[14px]`}
                              aria-hidden="true"
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[12.5px] font-semibold text-ew-ink">
                                {item.title}
                              </span>
                              {item.unread ? (
                                <span
                                  className="h-1.5 w-1.5 flex-none rounded-full bg-ew-pink"
                                  aria-hidden="true"
                                />
                              ) : null}
                            </span>
                            <span className="mt-0.5 block text-[11.5px] leading-snug text-ew-muted">
                              {item.body}
                            </span>
                            <span className="mt-1 block font-ew-mono text-[10px] uppercase tracking-[0.08em] text-ew-faint">
                              {item.at}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen((v) => !v);
                  setBellOpen(false);
                }}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label="Account menu"
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-ew-line py-1 pl-1 pr-2 transition-colors hover:bg-ew-bg-2"
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={employee.avatar || undefined} alt="" />
                  <AvatarFallback>{employee.firstName.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <span className="hidden flex-col items-start leading-none sm:flex">
                  <span className="text-[11.5px] font-semibold text-ew-ink">{employee.name}</span>
                  <span className="mt-0.5 text-[10px] text-ew-muted">{employee.role}</span>
                </span>
                <span className="flex h-4 w-4 items-center justify-center text-ew-muted">
                  <WorkspaceIcon className="ri-arrow-down-s-line text-[14px]" aria-hidden="true" />
                </span>
              </button>

              {menuOpen ? (
                <div
                  className="k-pop absolute right-0 top-[calc(100%+8px)] z-50 w-[240px] overflow-hidden rounded-xl border border-ew-line bg-ew-card"
                  role="menu"
                >
                  <div className="border-b border-ew-line-2 px-3.5 py-2.5">
                    <p className="text-[12.5px] font-semibold text-ew-ink">{employee.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-ew-muted">{employee.email}</p>
                    <p className="mt-1 font-ew-mono text-[10px] tracking-[0.08em] text-ew-faint">
                      {employee.employeeId} · {employee.team}
                    </p>
                  </div>
                  <div className="p-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenProfile();
                      }}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] text-ew-ink transition-colors hover:bg-ew-bg-2"
                    >
                      <span className="flex h-4 w-4 items-center justify-center text-ew-muted">
                        <WorkspaceIcon className="ri-user-settings-line" aria-hidden="true" />
                      </span>
                      Edit profile
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenQuotes();
                      }}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] text-ew-ink transition-colors hover:bg-ew-bg-2"
                    >
                      <span className="flex h-4 w-4 items-center justify-center text-ew-muted">
                        <WorkspaceIcon className="ri-notification-3-line" aria-hidden="true" />
                      </span>
                      Quote reminders
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onDownloadApp();
                      }}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] text-ew-ink transition-colors hover:bg-ew-bg-2"
                    >
                      <span className="flex h-4 w-4 items-center justify-center text-ew-muted">
                        <WorkspaceIcon className="ri-download-2-line" aria-hidden="true" />
                      </span>
                      Download app
                    </button>
                  </div>
                  <div className="border-t border-ew-line-2 p-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onLogout();
                      }}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] font-medium text-ew-bad transition-colors hover:bg-ew-bad-2"
                    >
                      <span className="flex h-4 w-4 items-center justify-center">
                        <WorkspaceIcon className="ri-logout-box-r-line" aria-hidden="true" />
                      </span>
                      Log out
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
