import type { ComponentProps } from "react";
import {
  AlarmClock,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Award,
  Bell,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Clock,
  Download,
  FileText,
  Image,
  ImagePlus,
  Inbox,
  LayoutGrid,
  ListTodo,
  LogOut,
  MessageSquare,
  Minus,
  Plus,
  Search,
  Send,
  Timer,
  Upload,
  UserRoundCog,
  X,
} from "lucide-react";

const icons = {
  "ri-add-line": Plus,
  "ri-alarm-warning-line": AlarmClock,
  "ri-arrow-down-line": ArrowDown,
  "ri-arrow-down-s-line": ChevronDown,
  "ri-arrow-left-s-line": ChevronLeft,
  "ri-arrow-right-line": ArrowRight,
  "ri-arrow-right-s-line": ChevronRight,
  "ri-arrow-right-up-line": ArrowUpRight,
  "ri-arrow-up-line": ArrowUp,
  "ri-award-line": Award,
  "ri-calendar-check-line": CalendarCheck,
  "ri-calendar-event-line": CalendarDays,
  "ri-chat-3-line": MessageSquare,
  "ri-check-line": Check,
  "ri-checkbox-circle-fill": CheckCircle,
  "ri-close-circle-fill": CircleX,
  "ri-close-line": X,
  "ri-download-2-line": Download,
  "ri-file-text-line": FileText,
  "ri-image-add-line": ImagePlus,
  "ri-image-line": Image,
  "ri-inbox-archive-line": Inbox,
  "ri-inbox-line": Inbox,
  "ri-layout-grid-line": LayoutGrid,
  "ri-logout-box-r-line": LogOut,
  "ri-notification-3-line": Bell,
  "ri-search-line": Search,
  "ri-send-plane-line": Send,
  "ri-subtract-line": Minus,
  "ri-task-line": ListTodo,
  "ri-time-fill": Clock,
  "ri-time-line": Clock,
  "ri-timer-line": Timer,
  "ri-upload-2-line": Upload,
  "ri-user-settings-line": UserRoundCog,
};

export function WorkspaceIcon({ className = "", ...props }: ComponentProps<"svg">) {
  const name = className.match(/ri-[\w-]+/)?.[0] as keyof typeof icons | undefined;
  const Icon = name ? (icons[name] ?? Clock) : Clock;
  return (
    <Icon
      {...props}
      className={className.replace(/ri-[\w-]+/, "")}
      style={{ width: "1em", height: "1em", ...props.style }}
    />
  );
}
