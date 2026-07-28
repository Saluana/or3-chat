import { beforeAll, describe, expect, it, vi } from "vitest";

let runExternalAgentBackground: typeof import("../external-agents.client").runExternalAgentBackground;

beforeAll(async () => {
  vi.stubGlobal("defineNuxtPlugin", (plugin: unknown) => plugin);
  ({ runExternalAgentBackground } = await import("../external-agents.client"));
});

describe("external agent plugin background startup", () => {
  it("returns without waiting for initialization and contains failures", async () => {
    let finish!: () => void;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onError = vi.fn();

    runExternalAgentBackground(task, onError, () => false);

    expect(task).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(task).toHaveBeenCalledOnce());
    expect(onError).not.toHaveBeenCalled();
    finish();
  });

  it("reports active startup failures but ignores work after disposal", async () => {
    const onError = vi.fn();
    runExternalAgentBackground(
      async () => {
        throw new Error("offline");
      },
      onError,
      () => false,
    );
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());

    const disposedTask = vi.fn(async () => undefined);
    runExternalAgentBackground(disposedTask, onError, () => true);
    await Promise.resolve();
    await Promise.resolve();

    expect(disposedTask).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });
});
