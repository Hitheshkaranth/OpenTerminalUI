import { useEffect, useRef, useState } from "react";
import { BellAlertIcon, BellIcon } from "@heroicons/react/24/outline";

import { NotificationPanel } from "./NotificationPanel";
import { useNotificationStore } from "../../store/notificationStore";

export function NotificationBell() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const isOpen = useNotificationStore((s) => s.isOpen);
  const togglePanel = useNotificationStore((s) => s.togglePanel);
  const closePanel = useNotificationStore((s) => s.closePanel);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousUnreadRef = useRef(0);
  const hasHydratedRef = useRef(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      void fetchNotifications();
    }
  }, [fetchNotifications, isOpen]);

  useEffect(() => {
    if (hasHydratedRef.current && unreadCount > previousUnreadRef.current) {
      setIsAnimating(true);
      const timer = window.setTimeout(() => setIsAnimating(false), 1000);
      previousUnreadRef.current = unreadCount;
      return () => window.clearTimeout(timer);
    }
    hasHydratedRef.current = true;
    previousUnreadRef.current = unreadCount;
    return undefined;
  }, [unreadCount]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        closePanel();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [closePanel, isOpen]);

  const Icon = unreadCount > 0 ? BellAlertIcon : BellIcon;

  return (
    <div ref={containerRef} className="relative border-l border-terminal-border pl-2">
      <button
        type="button"
        onClick={togglePanel}
        aria-label="Notifications"
        className={`relative inline-flex h-7 w-7 items-center justify-center rounded border border-terminal-border bg-terminal-bg ${
          unreadCount > 0 ? "text-terminal-text" : "text-terminal-muted"
        }`}
      >
        <Icon className={`h-4 w-4 ${isAnimating ? "animate-bounce" : ""}`} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>
      {isOpen ? <NotificationPanel onClose={closePanel} /> : null}
    </div>
  );
}
