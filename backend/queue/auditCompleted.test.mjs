import { describe, it, expect, vi } from "vitest";
import { handleAuditCompleted } from "./index.js";

function fakeEmailQueue() {
  return { add: vi.fn().mockResolvedValue({ id: "e1" }) };
}

function fakeServerCache() {
  const store = new Map();
  return {
    store,
    async setIfAbsent(key, value, ttl) {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    },
  };
}

describe("handleAuditCompleted", () => {
  it("creates an in-app notification + enqueues an email for video-audit", async () => {
    const notificationService = { createNotification: vi.fn().mockResolvedValue({}) };
    const emailQueue = fakeEmailQueue();
    const serverCache = fakeServerCache();
    const job = {
      id: "j1",
      data: { channelId: "c1", email: "user@b.com" },
      returnvalue: { score: 82, input: { channel: { name: "My Channel" } } },
    };
    await handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label: "video-audit", job });
    expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
    const note = notificationService.createNotification.mock.calls[0][0];
    expect(note.type).toBe("videoAuditComplete");
    expect(note.userId).toBe("user@b.com");
    expect(note.link).toBe("/video-audit");
    expect(note.body).toContain("82");
    expect(emailQueue.add).toHaveBeenCalledWith(
      "sendAuditCompleteEmail",
      expect.objectContaining({ toEmail: "user@b.com", auditType: "video", score: 82 }),
    );
  });

  it("notifies for thumbnail-optimizer completion", async () => {
    const notificationService = { createNotification: vi.fn().mockResolvedValue({}) };
    const emailQueue = fakeEmailQueue();
    const serverCache = fakeServerCache();
    const job = {
      id: "j4",
      data: { channelId: "c4", email: "u4@b.com", kind: "thumbnail" },
      returnvalue: { kind: "thumbnail", result: { results: [] } },
    };
    await handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label: "thumbnail-optimizer", job });
    const note = notificationService.createNotification.mock.calls[0][0];
    expect(note.type).toBe("thumbnailAuditComplete");
    expect(note.link).toBe("/thumbnail-optimizer");
    expect(emailQueue.add).toHaveBeenCalledWith(
      "sendAuditCompleteEmail",
      expect.objectContaining({ auditType: "thumbnail" }),
    );
  });

  it("notifies for playlist-optimizer completion", async () => {
    const notificationService = { createNotification: vi.fn().mockResolvedValue({}) };
    const emailQueue = fakeEmailQueue();
    const serverCache = fakeServerCache();
    const job = {
      id: "j5",
      data: { channelId: "c5", email: "u5@b.com", kind: "playlist" },
      returnvalue: { kind: "playlist", result: { playlists: [] } },
    };
    await handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label: "playlist-optimizer", job });
    const note = notificationService.createNotification.mock.calls[0][0];
    expect(note.type).toBe("playlistAuditComplete");
    expect(note.link).toBe("/playlist-optimizer");
    expect(emailQueue.add).toHaveBeenCalledWith(
      "sendAuditCompleteEmail",
      expect.objectContaining({ auditType: "playlist" }),
    );
  });

  it("unwraps a health-wrapped channel.name object into a clean body string", async () => {
    const notificationService = { createNotification: vi.fn().mockResolvedValue({}) };
    const emailQueue = fakeEmailQueue();
    const serverCache = fakeServerCache();
    const job = {
      id: "j3",
      data: { channelId: "c3", email: "u3@b.com" },
      returnvalue: { overall: 56, input: { channel: { name: { value: "Wrapped Chan", health: 50 } } } },
    };
    await handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label: "video-audit", job });
    const note = notificationService.createNotification.mock.calls[0][0];
    expect(note.body).toBe("Wrapped Chan scored 56.");
    expect(note.body).not.toContain("[object Object]");
  });

  it("creates the notification exactly once even when fired multiple times for the same job", async () => {
    const notificationService = { createNotification: vi.fn().mockResolvedValue({}) };
    const emailQueue = fakeEmailQueue();
    const serverCache = fakeServerCache();
    const job = {
      id: "dup1",
      data: { channelId: "c", email: "u@b.com" },
      returnvalue: { overall: 70, input: { channel: { name: "Chan" } } },
    };
    await handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label: "video-audit", job });
    await handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label: "video-audit", job });
    await handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label: "video-audit", job });
    expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
    expect(emailQueue.add).toHaveBeenCalledTimes(1);
  });

  it("ignores non-audit labels and missing email", async () => {
    const notificationService = { createNotification: vi.fn().mockResolvedValue({}) };
    const emailQueue = fakeEmailQueue();
    const serverCache = fakeServerCache();
    await handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label: "ingest", job: { id: "x", data: { email: "x@b.com" } } });
    await handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label: "audit", job: { id: "y", data: {} } });
    expect(notificationService.createNotification).not.toHaveBeenCalled();
    expect(emailQueue.add).not.toHaveBeenCalled();
  });

  it("swallows internal errors without throwing", async () => {
    const notificationService = { createNotification: vi.fn().mockRejectedValue(new Error("boom")) };
    const emailQueue = fakeEmailQueue();
    const serverCache = fakeServerCache();
    const job = { id: "z", data: { channelId: "c", email: "u@b.com" }, returnvalue: {} };
    await expect(
      handleAuditCompleted({ notificationService, emailQueue, serverCache }, { label: "video-audit", job }),
    ).resolves.toBeUndefined();
  });
});
