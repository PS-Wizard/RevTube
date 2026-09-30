/**
 * Native OS notification helpers (Web Notifications API).
 *
 * Audits run server-side in BullMQ, so closing the tab or leaving the page
 * never cancels them. These helpers let us surface a real OS-level
 * notification (Windows Action Center, macOS, etc.) when an audit completes
 * while the user is away from the app. The in-app bell + email already cover
 * the other cases; this is the third channel the user asked for.
 */

/** True when the browser supports the Web Notifications API. */
function supported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export type NotificationPermissionState = "default" | "granted" | "denied" | "unsupported";

/** Current permission without throwing on unsupported browsers. */
export function getNotificationPermission(): NotificationPermissionState {
  if (!supported()) return "unsupported";
  return Notification.permission as NotificationPermissionState;
}

/**
 * Ask the user for permission to show OS notifications. Returns the resulting
 * state. No-ops gracefully when unsupported or already decided.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!supported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission as NotificationPermissionState;
  try {
    const result = await Notification.requestPermission();
    return result as NotificationPermissionState;
  } catch {
    return "denied";
  }
}

/**
 * Fire a native OS notification (only when permission is granted). Returns the
 * created Notification, or null if not permitted/unsupported. Silently swallows
 * errors so a notification failure never breaks the app flow.
 */
export function showNativeNotification(
  title: string,
  options?: NotificationOptions,
): Notification | null {
  if (!supported() || Notification.permission !== "granted") return null;
  try {
    const n = new Notification(title, {
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      ...options,
    });
    n.onclick = () => {
      window.focus();
      if (options?.data?.url) window.location.href = options.data.url;
      n.close();
    };
    return n;
  } catch {
    return null;
  }
}
