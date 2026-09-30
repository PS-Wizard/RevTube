import { describe, it, expect, vi } from "vitest";
import { createNotificationService } from "./notificationService.js";

// In-memory fake for ServerCache (only get/set used here).
function fakeCache() {
  const store = new Map();
  return {
    async get(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async set(k, v) {
      store.set(k, v);
    },
    _store: store,
  };
}

describe("createNotificationService", () => {
  it("prepends a new notification and returns it with read:false", async () => {
    const cache = fakeCache();
    const svc = createNotificationService({ serverCache: cache });
    const note = await svc.createNotification({
      userId: "a@b.com",
      type: "auditComplete",
      title: "Audit done",
      body: "scored 80",
      link: "/audit",
    });
    expect(note.read).toBe(false);
    expect(note.id).toBeTruthy();
    const { items } = await svc.getNotifications("a@b.com");
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Audit done");
  });

  it("keeps newest-first and caps at 50 entries", async () => {
    const cache = fakeCache();
    const svc = createNotificationService({ serverCache: cache });
    for (let i = 0; i < 60; i++) {
      await svc.createNotification({ userId: "cap@b.com", type: "auditComplete", title: `n${i}` });
    }
    const { items } = await svc.getNotifications("cap@b.com");
    expect(items).toHaveLength(50);
    expect(items[0].title).toBe("n59"); // newest first
  });

  it("reports unreadCount and markRead flips one", async () => {
    const cache = fakeCache();
    const svc = createNotificationService({ serverCache: cache });
    const a = await svc.createNotification({ userId: "u@b.com", type: "auditComplete", title: "a" });
    await svc.createNotification({ userId: "u@b.com", type: "auditComplete", title: "b" });
    let list = await svc.getNotifications("u@b.com");
    expect(list.unreadCount).toBe(2);
    await svc.markRead("u@b.com", a.id);
    list = await svc.getNotifications("u@b.com");
    expect(list.unreadCount).toBe(1);
    expect(list.items.find((n) => n.id === a.id).read).toBe(true);
  });

  it("markAllRead flips every entry", async () => {
    const cache = fakeCache();
    const svc = createNotificationService({ serverCache: cache });
    await svc.createNotification({ userId: "m@b.com", type: "auditComplete", title: "a" });
    await svc.createNotification({ userId: "m@b.com", type: "auditComplete", title: "b" });
    await svc.markAllRead("m@b.com");
    const list = await svc.getNotifications("m@b.com");
    expect(list.unreadCount).toBe(0);
    expect(list.items.every((n) => n.read)).toBe(true);
  });

  it("isolates notifications per user", async () => {
    const cache = fakeCache();
    const svc = createNotificationService({ serverCache: cache });
    await svc.createNotification({ userId: "one@b.com", type: "auditComplete", title: "x" });
    const other = await svc.getNotifications("two@b.com");
    expect(other.items).toHaveLength(0);
  });
});
