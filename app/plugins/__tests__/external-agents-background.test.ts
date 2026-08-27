import { beforeAll, describe, expect, it, vi } from "vitest";
import type { InternClient } from "@or3/intern-client";

let runExternalAgentBackground: typeof import("../external-agents.client").runExternalAgentBackground;
let adaptInternClient: typeof import("../external-agents.client").adaptInternClient;
let isCurrentCloudHostWorkspace: typeof import("../external-agents.client").isCurrentCloudHostWorkspace;
let createCloudHostReconciler: typeof import("../external-agents.client").createCloudHostReconciler;
let parseCloudHostEnvironments: typeof import("../external-agents.client").parseCloudHostEnvironments;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  vi.stubGlobal("defineNuxtPlugin", (plugin: unknown) => plugin);
  ({
    runExternalAgentBackground,
    adaptInternClient,
    isCurrentCloudHostWorkspace,
    createCloudHostReconciler,
    parseCloudHostEnvironments,
  } = await import("../external-agents.client"));
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

  it("rolls back the whole batch when a later upload fails", async () => {
    let uploadCount = 0;
    const request = vi.fn(
      async (path: string, options?: { body?: unknown }) => {
        if (path === "/internal/v1/files/roots") {
          return { items: [{ id: "workspace", writable: true }] };
        }
        if (path === "/internal/v1/files/mkdir") {
          return { root_id: "workspace" };
        }
        if (path === "/internal/v1/files/upload") {
          uploadCount += 1;
          if (uploadCount === 2) {
            throw Object.assign(new Error("second upload failed"), {
              status: 500,
            });
          }
          const form = options?.body as FormData;
          return {
            root_id: "workspace",
            path: `${String(form.get("path"))}/notes.md`,
          };
        }
        if (path === "/internal/v1/files/staging/release") {
          expect(options?.body).toEqual({
            root_id: "workspace",
            path: expect.stringMatching(/^\.or3-upload-/),
          });
          return { status: "released" };
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );
    const client = adaptInternClient({
      transport: { request },
    } as unknown as InternClient);

    await expect(
      client.stageFiles([
        {
          id: "attachment-1",
          kind: "text",
          name: "notes.md",
          data: new Blob(["notes"]),
        },
        {
          id: "attachment-2",
          kind: "text",
          name: "todo.md",
          data: new Blob(["todo"]),
        },
      ]),
    ).rejects.toThrow("second upload failed");
    expect(request).toHaveBeenCalledWith(
      "/internal/v1/files/staging/release",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("refuses cleanup for an arbitrary workspace path", async () => {
    const request = vi.fn();
    const client = adaptInternClient({
      transport: { request },
    } as unknown as InternClient);

    const result = await client.releaseStagedFiles?.([
      {
        id: "workspace:keep.txt",
        source: "workspace_ref",
        kind: "text",
        name: "keep.txt",
        root_id: "workspace",
        path: "keep.txt",
      },
    ]);

    expect(result?.status).toBe("failed");
    expect(request).not.toHaveBeenCalled();
  });
});

describe("external agent plugin background startup", () => {
  it("drops cloud hosts whose runtime mount does not match its protocol", () => {
    expect(
      parseCloudHostEnvironments([
        {
          id: "openclaw-bad",
          name: "OpenClaw",
          baseUrl: "https://runtime.example/",
          accessToken: "token",
          driver: "runs",
          runtime: "openclaw",
        },
        {
          id: "hermes-bad",
          name: "Hermes",
          baseUrl: "https://runtime.example/or3/",
          accessToken: "token",
          driver: "runs",
          runtime: "hermes",
        },
        {
          id: "openclaw-good",
          name: "OpenClaw",
          baseUrl: "https://runtime.example/or3/",
          accessToken: "token",
          driver: "runs",
          runtime: "openclaw",
        },
        {
          id: "hermes-good",
          name: "Hermes",
          baseUrl: "https://runtime.example/",
          accessToken: "token",
          driver: "runs",
          runtime: "hermes",
        },
      ]),
    ).toEqual([
      expect.objectContaining({ environmentId: "openclaw-good" }),
      expect.objectContaining({ environmentId: "hermes-good" }),
    ]);
  });

  it("drops a cloud-host response after the active workspace changes", () => {
    expect(
      isCurrentCloudHostWorkspace("workspace-a", "workspace-a", "workspace-b"),
    ).toBe(false);
    expect(
      isCurrentCloudHostWorkspace("workspace-b", "workspace-a", "workspace-b"),
    ).toBe(false);
    expect(
      isCurrentCloudHostWorkspace("workspace-b", "workspace-b", "workspace-b"),
    ).toBe(true);
  });

  it("applies only the newest active workspace inventory when responses finish out of order", async () => {
    let activeWorkspaceId: string | null = "workspace-a";
    const responseA = deferred<Response>();
    const responseB = deferred<Response>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(responseA.promise)
      .mockReturnValueOnce(responseB.promise);
    const reconcileCloudHosts = vi.fn(async () => undefined);
    const reconciler = createCloudHostReconciler({
      controller: { reconcileCloudHosts },
      fetch,
      getActiveWorkspaceId: () => activeWorkspaceId,
      isEnabled: () => true,
      isDisposed: () => false,
    });

    const reconcileA = reconciler.reconcile("workspace-a");
    activeWorkspaceId = "workspace-b";
    const reconcileB = reconciler.reconcile("workspace-b");
    responseB.resolve({
      ok: true,
      json: async () => ({
        workspaceId: "workspace-b",
        environments: [
          {
            id: "env-b",
            name: "Workspace B computer",
            baseUrl: "https://env-b.connect.or3.test",
            accessToken: "token-b",
          },
        ],
      }),
    } as Response);
    await reconcileB;
    responseA.resolve({
      ok: true,
      json: async () => ({
        workspaceId: "workspace-a",
        environments: [
          {
            id: "env-a",
            name: "Workspace A computer",
            baseUrl: "https://env-a.connect.or3.test",
            accessToken: "token-a",
          },
        ],
      }),
    } as Response);
    await reconcileA;

    expect(reconcileCloudHosts).toHaveBeenCalledOnce();
    expect(reconcileCloudHosts).toHaveBeenCalledWith("workspace-b", [
      {
        environmentId: "env-b",
        name: "Workspace B computer",
        baseUrl: "https://env-b.connect.or3.test",
        token: "token-b",
      },
    ]);
    reconciler.dispose();
  });

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
