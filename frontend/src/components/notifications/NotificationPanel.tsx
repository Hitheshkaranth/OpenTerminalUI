import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BellIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  NewspaperIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { formatDistanceToNow, isToday, isYesterday } from "date-fns";

import { useNotificationStore } from "../../store/notificationStore";
import type { Notification } from "../../api/client";

type NotificationPanelProps = {
  onClose: () => void;
};

type NotificationGroup = {
  label: "Today" | "Yesterday" | "Older";
  items: Notification[];
};

const FILTERS: Array<{ key: "all" | Notification["type"]; label: string }> = [
  { key: "all", label: "All" },
  { key: "alert", label: "Alerts" },
  { key: "news", label: "News" },
  { key: "system", label: "System" },
  { key: "trade", label: "Trades" },
];

function notificationIcon(type: Notification["type"]) {
  if (type === "news") return NewspaperIcon;
  if (type === "system") return Cog6ToothIcon;
  if (type === "trade") return ChartBarIcon;
  return BellIcon;
}

function priorityDot(priority: Notification["priority"]) {
  if (priority === "critical") return "bg-terminal-neg";
  if (priority === "high") return "bg-amber-400";
  if (priority === "medium") return "bg-sky-400";
  return "bg-slate-500";
}

function groupNotifications(items: Notification[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Older", items: [] },
  ];

  for (const item of items) {
    const createdAt = new Date(item.created_at);
    if (isToday(createdAt)) {
      groups[0].items.push(item);
    } else if (isYesterday(createdAt)) {
      groups[1].items.push(item);
    } else {
      groups[2].items.push(item);
    }
  }

  return groups.filter((group) => group.items.length > 0);
}

export function NotificationPanel({ onClose }: NotificationPanelProps) {
  const navigate = useNavigate();
  const notifications = useNotificationStore((s) => s.notifications);
  const activeFilter = useNotificationStore((s) => s.activeFilter);
  const setFilter = useNotificationStore((s) => s.setFilter);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const dismiss = useNotificationStore((s) => s.dismiss);

  useEffect(() => {
    void fetchNotifications(activeFilter === "all" ? undefined : activeFilter);
  }, [activeFilter, fetchNotifications]);

  const groupedNotifications = useMemo(() => groupNotifications(notifications), [notifications]);

  const handleOpen = async (notification: Notification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    onClose();
    if (notification.action_url) {
      navigate(notification.action_url);
    }
  };

  return (
    <div
      className="absolute right-0 top-11 z-40 w-[24rem] overflow-hidden rounded border border-terminal-border bg-terminal-panel shadow-2xl"
      data-testid="notification-panel"
    >
      <div className="flex items-center justify-between border-b border-terminal-border px-3 py-2">
        <div className="text-sm font-semibold text-terminal-text">Notifications</div>
        <button
          type="button"
          onClick={() => void markAllRead()}
          className="text-[11px] uppercase tracking-wide text-terminal-accent hover:text-terminal-text"
        >
          Mark all read
        </button>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-terminal-border px-3 py-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setFilter(filter.key)}
            className={`rounded-full border px-2 py-1 text-[11px] ${
              activeFilter === filter.key
                ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                : "border-terminal-border text-terminal-muted hover:text-terminal-text"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div className="max-h-96 overflow-y-auto">
        {groupedNotifications.length ? (
          groupedNotifications.map((group) => (
            <section key={group.label} className="border-b border-terminal-border/50 px-3 py-2 last:border-b-0">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-terminal-muted">{group.label}</div>
              <div className="space-y-1">
                {group.items.map((notification) => {
                  const Icon = notificationIcon(notification.type);
                  return (
                    <div
                      key={notification.id}
                      className={`flex items-start gap-3 rounded border border-terminal-border/60 px-2 py-2 ${
                        notification.read ? "bg-terminal-bg/40" : "bg-terminal-accent/5"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void handleOpen(notification)}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      >
                        <span className="mt-0.5 rounded border border-terminal-border p-1 text-terminal-muted">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm ${notification.read ? "font-medium" : "font-semibold"}`}>
                            {notification.title}
                          </span>
                          <span className="block truncate text-xs text-terminal-muted">
                            {notification.body || "No additional details"}
                          </span>
                          <span className="mt-1 block text-[11px] text-terminal-muted">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </span>
                        </span>
                      </button>
                      <span className={`mt-1 h-2.5 w-2.5 rounded-full ${priorityDot(notification.priority)}`} />
                      <button
                        type="button"
                        aria-label={`Dismiss ${notification.title}`}
                        onClick={() => void dismiss(notification.id)}
                        className="text-terminal-muted hover:text-terminal-text"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        ) : (
          <div className="px-3 py-6 text-center text-sm text-terminal-muted">No notifications</div>
        )}
      </div>
      <div className="border-t border-terminal-border px-3 py-2 text-sm">
        <Link to="/equity/alerts" onClick={onClose} className="text-terminal-accent hover:text-terminal-text">
          View All Alerts →
        </Link>
      </div>
    </div>
  );
}
