// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Optimizer Service -- unit tests (network is mocked)
// Regression: videoTitle must come from YouTube metadata (oEmbed), never
// from the LLM guess -- Gemini invents titles from thumbnail pixels.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it, vi } from "vitest";
import { createThumbnailOptimizerService } from "./thumbnailOptimizerService";

const VIDEO_ID = "dQw4w9WgXcQ";
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const REAL_TITLE = "first badge down 7 to go";
const LLM_TITLE = "Pokemon Platinum Randomizer Nuzlocke - Part 12";

function geminiPayload(videoTitle) {
  return {
    data: {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  videoTitle,
                  reviewSummary: "summary",
                  strengths: "strengths",
                  opportunities: "opportunities",
                  currentScore: 7,
                  expectedScore: 9,
                  detailedAreas: [],
                }),
              },
            ],
          },
        },
      ],
    },
  };
}

function makeService({ oembedTitle = REAL_TITLE, oembedFails = false, imageFails = false } = {}) {
  const axios = {
    get: vi.fn(async (url) => {
      if (String(url).includes("oembed")) {
        if (oembedFails) throw new Error("oembed unavailable");
        return { data: { title: oembedTitle } };
      }
      if (imageFails) throw new Error("image unavailable");
      return { data: Buffer.from("fake-image"), headers: { "content-type": "image/jpeg" } };
    }),
    post: vi.fn(async () => geminiPayload(LLM_TITLE)),
  };
  const serverCache = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => true),
  };
  const service = createThumbnailOptimizerService({
    axios,
    serverCache,
    shortHash: (s) => `h${String(s).length}`,
    PERF_LOG_ENABLED: false,
    perfLog: () => {},
    perfNow: () => 0,
    getOptimizerCriteria: async () => null,
  });
  return { service, axios };
}

describe("thumbnailOptimizerService videoTitle", () => {
  it("prefers the YouTube metadata title over the LLM guess", async () => {
    const { service } = makeService();
    const { results } = await service.analyze([WATCH_URL], "General", "", "");
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe(WATCH_URL);
    expect(results[0].videoTitle).toBe(REAL_TITLE);
  });

  it("falls back to the LLM title when metadata is unavailable", async () => {
    const { service } = makeService({ oembedFails: true });
    const { results } = await service.analyze([WATCH_URL], "General", "", "");
    expect(results[0].videoTitle).toBe(LLM_TITLE);
  });

  it("still uses the real title when the thumbnail image fetch fails", async () => {
    const { service } = makeService({ imageFails: true });
    const { results } = await service.analyze([WATCH_URL], "General", "", "");
    expect(results[0].videoTitle).toBe(REAL_TITLE);
  });
});
