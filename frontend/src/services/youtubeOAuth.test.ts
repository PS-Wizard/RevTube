// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { YouTubeOAuth } from "./youtubeOAuth";

vi.mock("./authHeaders", () => ({
  getFirebaseAuthHeader: () => Promise.resolve({}),
}));

type Channel = { id: string; title: string; thumbnailUrl?: string };

function getAllChannels(oauth: YouTubeOAuth) {
  return (
    oauth as unknown as {
      getAllChannels: (token: string, email: string) => Promise<Channel[] | null>;
    }
  ).getAllChannels.bind(oauth);
}

function okResponse(items: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ items }),
    text: () => Promise.resolve(""),
  };
}

function errResponse(status: number) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(`HTTP ${status}`),
  };
}

const YT_ITEM = {
  id: "UC123",
  snippet: {
    title: "Test Channel",
    thumbnails: { default: { url: "https://img/default.jpg" } },
  },
};

describe("YouTubeOAuth.getAllChannels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns mapped channels on immediate success", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(okResponse([YT_ITEM]))));
    const channels = await getAllChannels(new YouTubeOAuth())("token", "");
    expect(channels).toEqual([
      { id: "UC123", title: "Test Channel", thumbnailUrl: "https://img/default.jpg" },
    ]);
  });

  it("retries a transient empty list (post-consent propagation lag)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse([]))
      .mockResolvedValueOnce(okResponse([YT_ITEM]));
    vi.stubGlobal("fetch", fetchMock);
    const channels = await getAllChannels(new YouTubeOAuth())("token", "");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(channels).toHaveLength(1);
  });

  it("returns null (not []) on persistent network failure", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("network down")));
    vi.stubGlobal("fetch", fetchMock);
    const channels = await getAllChannels(new YouTubeOAuth())("token", "");
    expect(channels).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns null without retrying on 401", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(errResponse(401)));
    vi.stubGlobal("fetch", fetchMock);
    const channels = await getAllChannels(new YouTubeOAuth())("token", "");
    expect(channels).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("YouTubeOAuth.isStandalonePwa", () => {
  it("is false in a regular browser context", () => {
    expect(YouTubeOAuth.isStandalonePwa()).toBe(false);
  });
});

describe("YouTubeOAuth exchange failure detail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exposes the backend rejection reason via lastError", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('{"error":{"message":"redirectUri not allowed"}}'),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const oauth = new YouTubeOAuth();
    const exchange = (
      oauth as unknown as {
        exchangeCodeForTokens: (code: string) => Promise<unknown>;
      }
    ).exchangeCodeForTokens.bind(oauth);
    const tokens = await exchange("code123");
    expect(tokens).toBeNull();
    expect(oauth.lastError).toContain("redirectUri not allowed");
  });
});
