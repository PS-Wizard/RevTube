// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { createElement, useRef } from "react";
import { useSessionJobId } from "./useSessionJobId";

type JobIdPair = readonly [string | null, (v: string | null) => void];

function renderHook() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const capturedRef: { current: JobIdPair | null } = { current: null };
  function Probe() {
    const pairRef = useRef<JobIdPair | null>(null);
    pairRef.current = useSessionJobId("video-audit", undefined);
    capturedRef.current = pairRef.current;
    return null;
  }
  act(() => {
    root.render(createElement(Probe));
  });
  return {
    get jobId() {
      return capturedRef.current ? capturedRef.current[0] : null;
    },
    setJobId(v: string | null) {
      act(() => capturedRef.current?.[1](v));
    },
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useSessionJobId", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it("restores a persisted jobId on mount", () => {
    sessionStorage.setItem("rt:jobId:video-audit", "restored-job");
    const h = renderHook();
    expect(h.jobId).toBe("restored-job");
    h.cleanup();
  });

  it("persists a set jobId to sessionStorage", () => {
    const h = renderHook();
    expect(h.jobId).toBeNull();
    h.setJobId("abc-123");
    expect(h.jobId).toBe("abc-123");
    expect(sessionStorage.getItem("rt:jobId:video-audit")).toBe("abc-123");
    h.cleanup();
  });

  it("removes the stored jobId when set to null", () => {
    sessionStorage.setItem("rt:jobId:video-audit", "keep");
    const h = renderHook();
    h.setJobId(null);
    expect(h.jobId).toBeNull();
    expect(sessionStorage.getItem("rt:jobId:video-audit")).toBeNull();
    h.cleanup();
  });

  it("scopes keys by orgId", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const capturedRef: { current: JobIdPair | null } = { current: null };
    function Probe() {
      const pairRef = useRef<JobIdPair | null>(null);
      pairRef.current = useSessionJobId("video-audit", "org-99");
      capturedRef.current = pairRef.current;
      return null;
    }
    act(() => root.render(createElement(Probe)));
    act(() => capturedRef.current?.[1]("org-job"));
    expect(sessionStorage.getItem("rt:jobId:video-audit:org:org-99")).toBe("org-job");
    expect(sessionStorage.getItem("rt:jobId:video-audit")).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it("re-reads storage when the orgId (and thus key) changes after mount", () => {
    // Simulates a page refresh where the org context resolves asynchronously:
    // the hook mounts with orgId undefined (non-org key), then the org loads and
    // the key becomes org-scoped. The stored job was written under the org key,
    // so it must be restored once the org resolves -- not lost.
    sessionStorage.setItem(
      "rt:jobId:video-audit:org:org-42",
      "org-running-job",
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const capturedRef: {
      current: ((v: string | null) => void) | null;
      get: () => string | null;
    } = { current: null, get: () => null };
    let orgId: string | null = null;
    function Probe() {
      const [jobId, setJobId] = useSessionJobId("video-audit", orgId);
      capturedRef.current = setJobId;
      capturedRef.get = () => jobId;
      return null;
    }
    act(() => root.render(createElement(Probe)));
    // First render: org not yet resolved -> non-org key -> nothing stored there.
    expect(capturedRef.get()).toBeNull();
    // Org resolves -> re-render with the org key -> hook must re-read storage.
    act(() => {
      orgId = "org-42";
      root.render(createElement(Probe));
    });
    expect(capturedRef.get()).toBe("org-running-job");
    act(() => root.unmount());
    container.remove();
  });
});
