import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellRing } from "lucide-react";
import toast from "react-hot-toast";
import { useNotifications } from "../hooks/queries/useNotifications";
import { useNotificationStore } from "../stores/notificationStore";
import { markRead, markAllRead } from "../services/notificationService";
import { showNativeNotification } from "../services/nativeNotify";
import { Button } from "./ui";
import type { NotificationItem } from "../types/notification";
import "./NotificationBell.css";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const { data } = useNotifications();
  const { items, unreadCount, setNotifications, markOneRead, markAllReadLocal } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync the polling query into the local store.
  useEffect(() => {
    if (data) setNotifications(data.items, data.unreadCount);
  }, [data, setNotifications]);

  // Toast only for notifications that arrive *after* the first hydration, and
  // only while unread. Historical unread items from prior sessions are seeded
  // into `seen` on first load so they don't re-toast (which caused toast floods).
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) {
      for (const n of items) seen.current.add(n.id);
      hydrated.current = true;
      return;
    }
    for (const n of items) {
      if (!seen.current.has(n.id) && !n.read) {
        seen.current.add(n.id);
        toast.success(`New notification: ${n.title}`, { id: `notif-${n.id}` });
        // Surface a real OS notification (Windows/OS-level) when the app is in
        // the background and the user has granted permission. The in-app bell
        // + email already cover the visible/away-email cases.
        if (typeof document !== "undefined" && document.hidden) {
          showNativeNotification(`RevTube: ${n.title}`, {
            body: n.body,
            tag: `notif-${n.id}`,
            data: { url: n.link },
          });
        }
      }
    }
  }, [items]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => setOpen((v) => !v);

  const handleClick = (n: NotificationItem) => {
    markRead(n.id).catch(() => {});
    markOneRead(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const handleMarkAll = () => {
    markAllRead().catch(() => {});
    markAllReadLocal();
  };

  return (
    <div className="notif-bell" ref={containerRef}>
      <Button variant="ghost" size="icon"
        bare
       
        onClick={handleOpen}
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        title="Notifications"
      >
        {unreadCount > 0 ? <BellRing size={18} /> : <Bell size={18} />}
        {unreadCount > 0 && (
          <span className="notif-bell__badge" aria-hidden>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="notif-bell__panel" role="menu">
          <div className="notif-bell__header">
            <span>Notifications</span>
            {items.length > 0 && (
              <Button variant="ghost" onClick={handleMarkAll}>
                Mark all read
              </Button>
            )}
          </div>
          <div className="notif-bell__list">
            {items.length === 0 ? (
              <div className="notif-bell__empty">No notifications yet.</div>
            ) : (
              items.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  className={`notif-bell__item${n.read ? " is-read" : ""}`}
                  onClick={() => handleClick(n)}
                >
                  <div className="notif-bell__item-title">{n.title}</div>
                  <div className="notif-bell__item-body">{n.body}</div>
                  <div className="notif-bell__item-time">{relativeTime(n.createdAt)}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
