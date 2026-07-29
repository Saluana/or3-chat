import { beforeAll, describe, expect, it, vi } from "vitest";
import type { InternClient } from "@or3/intern-client";

let runExternalAgentBackground: typeof import("../external-agents.client").runExternalAgentBackground;
let adaptInternClient: typeof import("../external-agents.client").adaptInternClient;

beforeAll(async () => {
  vi.stubGlobal("defineNuxtPlugin", (plugin: unknown) => plugin);
  ({ runExternalAgentBackground, adaptInternClient } =
    await import("../external-agents.client"));
});

describe("external agent attachment staging", () => {
  it("uploads files into a unique workspace directory and returns workspace references", async () => {
    const request = vi.fn(
      async (path: string, options?: { body?: unknown }) => {
        if (path === "/internal/v1/files/roots") {
          return { items: [{ id: "workspace", writable: true }] };
        }
        if (path === "/internal/v1/files/mkdir") {
          return { root_id: "workspace", path: ".or3-upload-test" };
        }
        if (path === "/internal/v1/files/upload") {
          const form = options?.body as FormData;
          expect(form.get("root_id")).toBe("workspace");
          expect(String(form.get("path"))).toMatch(/^\.or3-upload-/);
          expect((form.get("file") as File).name).toBe("notes.md");
          return {
            root_id: "workspace",
            path: `${String(form.get("path"))}/notes.md`,
          };
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );
    const client = adaptInternClient({
      transport: { request },
    } as unknown as InternClient);
    const file = new Blob(["# Notes"], { type: "text/markdown" });

    const staged = await client.stageFiles([
      {
        id: "attachment-1",
        kind: "text",
        name: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: file.size,
        data: file,
      },
    ]);

    expect(staged).toEqual([
      expect.objectContaining({
        source: "workspace_ref",
        kind: "text",
        name: "notes.md",
        mime_type: "text/markdown",
        size_bytes: file.size,
        root_id: "workspace",
        path: expect.stringMatching(/^\.or3-upload-.+\/notes\.md$/),
      }),
    ]);
    expect(request).toHaveBeenCalledTimes(3);
  });
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
