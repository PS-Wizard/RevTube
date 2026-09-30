// ── Notification store -- per-user in-app notifications ──
// Persisted in ServerCache (Redis, in-memory fallback) as a capped JSON array
// keyed by user. Avoids Firestore quota; the client polls a thin endpoint.
const { randomUUID } = require("crypto");

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CAP = 50;
const KEY = (userId) => `notif:${userId}`;

function createNotificationService({ serverCache }) {
  // Prepend a new notification; cap to CAP entries (newest first).
  async function createNotification({ userId, type, title, body, link }) {
    const note = {
      id: randomUUID(),
      type,
      title,
      body,
      link: link ?? null,
      read: false,
      createdAt: new Date().toISOString(),
      userId,
    };
    const existing = (await serverCache.get(KEY(userId))) || [];
    const next = [note, ...existing].slice(0, CAP);
    await serverCache.set(KEY(userId), next, TTL_MS);
    return note;
  }

  async function getNotifications(userId) {
    const list = (await serverCache.get(KEY(userId))) || [];
    return { items: list, unreadCount: list.filter((n) => !n.read).length };
  }

  async function markRead(userId, id) {
    const list = (await serverCache.get(KEY(userId))) || [];
    const next = list.map((n) => (n.id === id ? { ...n, read: true } : n));
    await serverCache.set(KEY(userId), next, TTL_MS);
    return next;
  }

  async function markAllRead(userId) {
    const list = (await serverCache.get(KEY(userId))) || [];
    const next = list.map((n) => ({ ...n, read: true }));
    await serverCache.set(KEY(userId), next, TTL_MS);
    return next;
  }

  return { createNotification, getNotifications, markRead, markAllRead };
}

module.exports = { createNotificationService };
