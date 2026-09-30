import { describe, it, expect, vi } from "vitest";
import { createPublicAuditProcessor } from "./publicAuditQueue.js";

// The processor is thin glue over services/publicAuditRunner.js (shared with
// the synchronous POST / route): validate job data, run, report progress.
// Heavy pipeline behavior is covered by the runner/route suites; here we
// assert delegation, progress, and validation with DI fakes (no Redis/PG).
describe("publicAuditQueue processor", () => {
  function makeProcessor() {
    const report = {
      id: 7,
      channelInput: "@demo",
      channelId: "UC123",
      channelTitle: "Demo Channel",
      videoCount: 2,
      overall: 81,
      results: [{ videoId: "v1", total: 81 }],
    };
    const runPublicAuditReport = vi.fn().mockResolvedValue(report);
    const processor = createPublicAuditProcessor({ runPublicAuditReport });
    return { processor, runPublicAuditReport, report };
  }

  it("runs the shared runner with job data + attribution and hits 100", async () => {
    const { processor, runPublicAuditReport, report } = makeProcessor();
    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const result = await processor({
      id: "job-1",
      data: {
        channelInput: "@demo",
        maxVideos: 50,
        includeAllPlaylists: true,
        includeThumbnail: false,
        includeCaptions: false,
        uid: "admin1",
        email: "admin@x.com",
      },
      updateProgress,
    });
    expect(runPublicAuditReport).toHaveBeenCalledTimes(1);
    const [deps, opts] = runPublicAuditReport.mock.calls[0];
    expect(opts.channelInput).toBe("@demo");
    expect(opts.maxVideos).toBe(50);
    expect(opts.includeAllPlaylists).toBe(true);
    expect(opts.includeThumbnail).toBe(false);
    expect(opts.includeCaptions).toBe(false);
    expect(opts.createdBy).toEqual({ uid: "admin1", email: "admin@x.com" });
    expect(typeof opts.onProgress).toBe("function");
    // Progress callback forwards to the BullMQ job (capped at 99; 100 on done).
    opts.onProgress(42);
    expect(updateProgress).toHaveBeenCalledWith(42);
    opts.onProgress(150);
    expect(updateProgress).toHaveBeenCalledWith(99);
    expect(updateProgress).toHaveBeenCalledWith(100);
    expect(result).toBe(report);
    expect(deps.runPublicAuditReport).toBe(runPublicAuditReport);
  });

  it("throws on missing channelInput", async () => {
    const { processor } = makeProcessor();
    await expect(
      processor({ id: "j1", data: {}, updateProgress: vi.fn() }),
    ).rejects.toThrow("channelInput");
    await expect(
      processor({ id: "j2", data: { channelInput: "   " }, updateProgress: vi.fn() }),
    ).rejects.toThrow("channelInput");
  });
});
