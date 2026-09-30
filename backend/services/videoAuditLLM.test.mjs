import { describe, it, expect, vi, afterEach } from "vitest";
import { createVideoAuditLLM } from "./videoAuditLLM.js";

function fakeAxios(respond) {
  return {
    post: vi.fn().mockResolvedValue(respond),
    get: vi.fn().mockResolvedValue({ data: {}, headers: { "content-type": "image/jpeg" } }),
  };
}

describe("videoAuditLLM", () => {
  afterEach(() => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  it("deepSeekText grounds the score in the video's keywords + scoring bands", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const axios = fakeAxios({ data: { choices: [{ message: { content: '{"score": 8}' } }] } });
    const llm = createVideoAuditLLM({ axios });

    const score = await llm.deepSeekText({
      text: "Python data science tutorial",
      instruction: "How clear is the title?",
      keywords: ["python", "data", "science"],
      element: "title",
      category: "discoverability",
    });

    expect(score).toBe(8);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const body = axios.post.mock.calls[0][1];
    const userPrompt = body.messages[1].content;
    // The video's own topic keywords are surfaced to the model.
    expect(userPrompt).toContain("python");
    expect(userPrompt).toContain("core topic keywords");
    // Explicit bands steer away from a flat ~7 anchor.
    expect(userPrompt).toContain("9-10 excellent");
    expect(body.messages[0].content).toContain("do not anchor");
    expect(body.response_format.type).toBe("json_object");
  });

  it("deepSeekText scores 0 with no keywords line when text is absent", async () => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    const axios = fakeAxios({});
    const llm = createVideoAuditLLM({ axios });
    expect(await llm.deepSeekText({ text: "" })).toBe(0);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("geminiVision scores against category bands", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const axios = {
      get: vi.fn().mockResolvedValue({ data: Buffer.from("x"), headers: { "content-type": "image/jpeg" } }),
      post: vi.fn().mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: '{"score": 9}' }] } }] } }),
    };
    const llm = createVideoAuditLLM({ axios });

    const score = await llm.geminiVision({ url: "http://x/1.jpg", instruction: "Eye-catching?", category: "visualHook" });
    expect(score).toBe(9);
    const prompt = axios.post.mock.calls[0][1].contents[0].parts[1].text;
    expect(prompt).toContain("9-10 bold, high-contrast");
    expect(prompt).toContain("do not anchor");
  });
});