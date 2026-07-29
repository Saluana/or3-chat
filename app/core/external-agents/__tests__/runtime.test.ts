import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalAgentController } from "../controller";
import {
  resetExternalAgentRuntimeForTests,
  setExternalAgentController,
  useExternalAgentRuntime,
} from "../runtime";
import type {
  ExternalAgentStoreEvent,
  ExternalAgentStoreSnapshot,
} from "../types";

function snapshot(generation: number): ExternalAgentStoreSnapshot {
  return {
    hosts: [],
    activeHostId: null,
    connectionState: "online",
    connectionError: null,
    generation,
    health: null,
    readiness: null,
    capabilities: null,
    runners: [],
    sessions: [],
    sessionRefs: [],
  };
}

afterEach(() => {
  resetExternalAgentRuntimeForTests();
  vi.unstubAllGlobals();
});

describe("external agent runtime", () => {
  it("publishes at most one Vue snapshot per animation frame", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    let listener: ((event: ExternalAgentStoreEvent) => void) | undefined;
    const controller = {
      snapshot: snapshot(1),
      subscribe(next: (event: ExternalAgentStoreEvent) => void) {
        listener = next;
        return vi.fn();
      },
    } as unknown as ExternalAgentController;

    setExternalAgentController(controller);
    const runtime = useExternalAgentRuntime();
    listener?.({ type: "snapshot", snapshot: snapshot(2) });
    listener?.({ type: "snapshot", snapshot: snapshot(3) });

    expect(runtime.snapshot.value?.generation).toBe(1);
    expect(frames).toHaveLength(1);

    frames[0]?.(16);

    expect(runtime.snapshot.value?.generation).toBe(3);
  });
});
