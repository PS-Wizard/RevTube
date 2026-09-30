// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getNotificationPermission,
  showNativeNotification,
  requestNotificationPermission,
} from "./nativeNotify";

function installNotificationMock(permission: string) {
  class MockNotification {
    title: string;
    close: () => void = () => {};
    onclick: (() => void) | null = null;
    constructor(title: string, opts?: NotificationOptions) {
      this.title = title;
      if (opts?.data?.url) {
        this.onclick = () => {
          window.location.href = (opts.data as { url: string }).url;
          this.close();
        };
      }
    }
  }
  const Ctor = vi.fn(function (
    this: MockNotification,
    title: string,
    opts?: NotificationOptions,
  ) {
    const n = new MockNotification(title, opts);
    this.title = n.title;
    this.close = n.close;
    this.onclick = n.onclick;
  }) as unknown as (typeof Notification & { permission: string }) & {
    new (title: string, opts?: NotificationOptions): Notification;
  };
  Object.defineProperty(Ctor, "permission", { value: permission });
  (globalThis as Record<string, unknown>).Notification = Ctor;
  (window as unknown as Record<string, unknown>).Notification = Ctor;
  return Ctor;
}

function removeNotificationMock() {
  delete (globalThis as Record<string, unknown>).Notification;
  delete (window as unknown as Record<string, unknown>).Notification;
}

describe("nativeNotify", () => {
  afterEach(() => {
    removeNotificationMock();
    vi.restoreAllMocks();
  });

  it("getNotificationPermission reports unsupported when the API is absent", () => {
    removeNotificationMock();
    expect(getNotificationPermission()).toBe("unsupported");
  });

  it("showNativeNotification returns null when permission is not granted", () => {
    installNotificationMock("denied");
    expect(showNativeNotification("hi", { body: "b" })).toBeNull();
  });

  it("showNativeNotification fires a Notification when granted", () => {
    const ctor = installNotificationMock("granted");
    const n = showNativeNotification("Audit done", { body: "score 90", data: { url: "/audit" } });
    expect(n).not.toBeNull();
    expect(ctor).toHaveBeenCalledWith("Audit done", expect.objectContaining({ body: "score 90" }));
  });

  it("requestNotificationPermission resolves to current state when not default", async () => {
    installNotificationMock("denied");
    expect(await requestNotificationPermission()).toBe("denied");
  });

  it("requestNotificationPermission calls Notification.requestPermission when default", async () => {
    installNotificationMock("default");
    const requestSpy = vi.fn(async () => "granted");
    Object.defineProperty(Notification, "requestPermission", { value: requestSpy });
    expect(await requestNotificationPermission()).toBe("granted");
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it("requestNotificationPermission returns denied on throw", async () => {
    installNotificationMock("default");
    Object.defineProperty(
      Notification,
      "requestPermission",
      { value: vi.fn(async () => { throw new Error("nope"); }) },
    );
    expect(await requestNotificationPermission()).toBe("denied");
  });
});
