import { createInternClient, type InternClient } from "@or3/intern-client";
import { watch } from "vue";
import { useSessionContext } from "~/composables/auth/useSessionContext";
import { usePaneApps } from "~/composables/core/usePaneApps";
import { useSidebarPages } from "~/composables/sidebar/useSidebarPages";
import { getActivityRegistry } from "~/core/activity/registry";
import { createExternalAgentActivitySource } from "~/core/external-agents/activity-adapter";
import { registerExternalAgentCommands } from "~/core/external-agents/commands";
import { ExternalAgentController } from "~/core/external-agents/controller";
import { getExternalAgentCredentialVault } from "~/core/external-agents/credentials";
import { createExternalAgentDriverDetector } from "~/core/external-agents/driver-detection";
import { normalizeExternalAgentBaseUrl } from "~/core/external-agents/host-registry";
import { createWorkspaceExternalAgentPersistence } from "~/core/external-agents/persistence";
import { createRunsExternalAgentClient } from "~/core/external-agents/runs-client";
import {
  encodeExternalAgentSessionRef,
  EXTERNAL_AGENT_LAUNCHER_REF,
  EXTERNAL_AGENT_PANE_APP_ID,
  EXTERNAL_AGENTS_SIDEBAR_PAGE_ID,
} from "~/core/external-agents/refs";
import { setExternalAgentPaneRecord } from "~/core/external-agents/pane";
import {
  setExternalAgentCloudHostRefresh,
  setExternalAgentController,
} from "~/core/external-agents/runtime";
import type {
  ExternalAgentAttachment,
  ExternalAgentClient,
  ExternalAgentClientFactory,
  ExternalAgentDriver,
  ExternalAgentSession,
  ExternalAgentUploadAttachment,
} from "~/core/external-agents/types";
import { externalAgentDriver } from "~/core/external-agents/types";
import { getActiveWorkspaceId, subscribeActiveWorkspaceDb } from "~/db/client";
import { getGlobalMultiPaneApi } from "~/utils/multiPaneApi";

export function adaptInternClient(client: InternClient): ExternalAgentClient {
  const stageFiles = async (
    attachments: readonly ExternalAgentUploadAttachment[],
    options?: { signal?: AbortSignal },
  ): Promise<readonly ExternalAgentAttachment[]> => {
    if (!attachments.length) return [];
    const rootsResponse = await client.transport.request<{
      items?: Array<{
        id: string;
        writable?: boolean;
      }>;
    }>("/internal/v1/files/roots", {
      signal: options?.signal,
    });
    const workspaceRoot = rootsResponse.items?.find(
      (root) => root.id === "workspace",
    );
    if (!workspaceRoot) {
      throw new Error(
        "This host does not expose a workspace for agent attachments.",
      );
    }
    if (workspaceRoot.writable === false) {
      throw new Error(
        "This host's workspace is read-only, so files cannot be attached.",
      );
    }

    const batchName = `.or3-upload-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    await client.transport.request("/internal/v1/files/mkdir", {
      method: "POST",
      body: {
        root_id: workspaceRoot.id,
        path: ".",
        name: batchName,
      },
      signal: options?.signal,
    });

    const staged: ExternalAgentAttachment[] = [];
    for (const attachment of attachments) {
      const form = new FormData();
      form.set("root_id", workspaceRoot.id);
      form.set("path", batchName);
      form.set("file", attachment.data, attachment.name);
      const uploaded = await client.transport.request<{
        root_id?: string;
        path?: string;
      }>("/internal/v1/files/upload", {
        method: "POST",
        body: form,
        signal: options?.signal,
      });
      const rootId = uploaded.root_id || workspaceRoot.id;
      const path = uploaded.path || `${batchName}/${attachment.name}`;
      staged.push({
        id: `${rootId}:${path}`,
        source: "workspace_ref",
        kind: attachment.kind,
        name: attachment.name,
        mime_type: attachment.mimeType || undefined,
        size_bytes: attachment.sizeBytes,
        root_id: rootId,
        path,
        preview: path,
      });
    }
    return staged;
  };

  return {
    health: (options) => client.health(options),
    readiness: (options) => client.readiness(options),
    capabilities: (options) => client.capabilities({}, options),
    listRunners: (options) => client.listRunners(options),
    createSession: (input, options) => client.createSession(input, options),
    listSessions: (input, options) => client.listSessions(input, options),
    getSession: (sessionId, options) => client.getSession(sessionId, options),
    listTurns: (sessionId, input = {}) =>
      client.listTurns(
        sessionId,
        { limit: input.limit },
        { signal: input.signal },
      ),
    startTurn: (sessionId, input, options) =>
      client.startTurn(
        sessionId,
        {
          ...input,
          attachments: input.attachments?.map((attachment) => ({
            ...attachment,
          })),
        },
        options,
      ),
    stageFiles,
    getTurn: (sessionId, turnId, options) =>
      client.getTurn(sessionId, turnId, options),
    listTurnEvents: (sessionId, turnId, input = {}) =>
      client.listTurnEvents(
        sessionId,
        turnId,
        { afterSeq: input.afterSeq, limit: input.limit },
        { signal: input.signal },
      ),
    streamTurn: (sessionId, turnId, input = {}) =>
      client.streamTurn(sessionId, turnId, {
        afterSeq: input.afterSeq,
        signal: input.signal,
      }),
    abortTurn: (sessionId, turnId, options) =>
      client.abortTurn(sessionId, turnId, options),
    decideTurn: (sessionId, turnId, decision, input, options) =>
      client.decideTurn(sessionId, turnId, decision, input, options),
    readArtifact: (artifactId, input, options) =>
      client.readArtifact(artifactId, input, options),
  };
}

export const createInternExternalAgentClient: ExternalAgentClientFactory = ({
  host,
  resolveCredential,
}) => {
  let requestSequence = 0;
  const fetchWithoutCache = ((
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ) => {
    const method =
      init?.method ??
      (typeof Request !== "undefined" && input instanceof Request
        ? input.method
        : "GET");
    let requestInput = input;
    if (
      method.toUpperCase() === "GET" &&
      (typeof input === "string" || input instanceof URL)
    ) {
      const url = new URL(String(input));
      url.searchParams.set(
        "_or3_request",
        `${Date.now()}-${++requestSequence}`,
      );
      requestInput = url;
    }
    return globalThis.fetch(requestInput, { ...init, cache: "no-store" });
  }) as typeof fetch;

  return adaptInternClient(
    createInternClient({
      baseUrl: host.baseUrl,
      fetch: fetchWithoutCache,
      resolveAuth: async () => {
        const token = await resolveCredential();
        return token
          ? {
              token,
              headers: host.id.startsWith("or3-connect:")
                ? { "X-Or3-Auth-Method": "paired-device" }
                : undefined,
            }
          : null;
      },
      defaultTimeoutMs: 15_000,
      streamConnectTimeoutMs: 20_000,
    }),
  );
};

const externalAgentClientFactories: Record<
  ExternalAgentDriver,
  ExternalAgentClientFactory
> = {
  intern: createInternExternalAgentClient,
  runs: ({ host, resolveCredential }) =>
    createRunsExternalAgentClient({
      baseUrl: host.baseUrl,
      resolveCredential,
    }),
};

export const createExternalAgentClient: ExternalAgentClientFactory = (input) =>
  externalAgentClientFactories[externalAgentDriver(input.host)](input);

export function runExternalAgentBackground(
  task: () => Promise<unknown>,
  onError: () => void,
  isDisposed: () => boolean,
): void {
  void Promise.resolve()
    .then(() => {
      if (isDisposed()) return;
      return task();
    })
    .catch(() => {
      if (!isDisposed()) onError();
    });
}

export function isCurrentCloudHostWorkspace(
  expectedWorkspaceId: string,
  responseWorkspaceId: string | undefined,
  activeWorkspaceId: string | null | undefined,
): boolean {
  return (
    responseWorkspaceId === expectedWorkspaceId &&
    (activeWorkspaceId ?? "local") === expectedWorkspaceId
  );
}

interface CloudHostEnvironment {
  readonly environmentId: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly token: string;
  readonly driver?: ExternalAgentDriver;
  readonly runtime?: "intern" | "openclaw" | "hermes";
}

export function parseCloudHostEnvironments(
  value: unknown,
): CloudHostEnvironment[] | null {
  if (!Array.isArray(value)) return null;
  const environments: CloudHostEnvironment[] = [];
  for (const [index, candidate] of value.entries()) {
    const candidateId =
      candidate &&
      typeof candidate === "object" &&
      typeof (candidate as Record<string, unknown>).id === "string"
        ? String((candidate as Record<string, unknown>).id).slice(0, 120)
        : `record-${index}`;
    const skip = (reason: string) => {
      console.warn(
        `[external-agents] skipping cloud host ${candidateId}: ${reason}`,
      );
    };
    if (!candidate || typeof candidate !== "object") {
      skip("record is not an object");
      continue;
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.name !== "string" ||
      typeof record.baseUrl !== "string" ||
      typeof record.accessToken !== "string" ||
      !record.id.trim() ||
      !record.name.trim() ||
      !record.baseUrl.trim() ||
      !record.accessToken.trim()
    ) {
      skip("required fields are missing");
      continue;
    }
    if (
      (record.driver !== undefined &&
        record.driver !== "intern" &&
        record.driver !== "runs") ||
      (record.runtime !== undefined &&
        record.runtime !== "intern" &&
        record.runtime !== "openclaw" &&
        record.runtime !== "hermes")
    ) {
      skip("runtime or driver is unsupported");
      continue;
    }
    const driver = record.driver as ExternalAgentDriver | undefined;
    const runtime = record.runtime as
      | "intern"
      | "openclaw"
      | "hermes"
      | undefined;
    let baseUrl: string;
    try {
      baseUrl = normalizeExternalAgentBaseUrl(record.baseUrl);
    } catch {
      skip("base URL is invalid");
      continue;
    }
    // Runtime metadata is optional for legacy Intern records. If present,
    // only accept known driver/runtime combinations.
    if (
      (runtime && !driver && runtime !== "intern") ||
      (driver === "runs" && !runtime) ||
      (runtime === "intern" && driver && driver !== "intern") ||
      (runtime && runtime !== "intern" && driver && driver !== "runs")
    ) {
      skip("runtime and driver metadata do not match");
      continue;
    }
    // The runtime adapter owns a fixed protocol mount. Accepting a valid URL
    // with the wrong path would create a host that can connect to the tunnel
    // but can never reach its capabilities endpoint.
    if (runtime === "openclaw" || runtime === "hermes") {
      const pathname = new URL(baseUrl).pathname.replace(/\/+$/u, "") || "/";
      const expectedPath = runtime === "openclaw" ? "/or3" : "/";
      if (pathname !== expectedPath) {
        skip(
          `base URL must use the ${expectedPath === "/" ? "/" : `${expectedPath}/`} runtime path`,
        );
        continue;
      }
    }
    environments.push({
      environmentId: record.id,
      name: record.name,
      baseUrl,
      token: record.accessToken,
      driver,
      runtime,
    });
  }
  return environments;
}

export function createCloudHostReconciler(input: {
  readonly controller: Pick<ExternalAgentController, "reconcileCloudHosts">;
  readonly fetch: (
    request: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ) => Promise<Response>;
  readonly getActiveWorkspaceId: () => string | null | undefined;
  readonly isEnabled: () => boolean;
  readonly isDisposed: () => boolean;
}): {
  readonly reconcile: (expectedWorkspaceId?: string) => Promise<void>;
  readonly invalidate: () => void;
  readonly dispose: () => void;
} {
  let generation = 0;
  let requestController: AbortController | null = null;

  const invalidate = () => {
    generation += 1;
    requestController?.abort();
    requestController = null;
  };
  const reconcile = async (expectedWorkspaceId?: string) => {
    if (!input.isEnabled() || input.isDisposed()) return;
    const workspaceId =
      expectedWorkspaceId?.trim() ||
      input.getActiveWorkspaceId()?.trim() ||
      "local";
    if ((input.getActiveWorkspaceId()?.trim() || "local") !== workspaceId) {
      return;
    }

    const requestGeneration = ++generation;
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    try {
      const result = await input.fetch("/api/connect/environments", {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!result.ok) return;
      const response = (await result.json()) as {
        workspaceId?: string;
        environments?: unknown;
      };
      if (
        controller.signal.aborted ||
        requestGeneration !== generation ||
        input.isDisposed() ||
        !isCurrentCloudHostWorkspace(
          workspaceId,
          response.workspaceId,
          input.getActiveWorkspaceId(),
        )
      ) {
        return;
      }
      const environments = parseCloudHostEnvironments(response.environments);
      if (!environments) return;
      await input.controller.reconcileCloudHosts(workspaceId, environments);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (requestController === controller) requestController = null;
    }
  };
  return {
    reconcile,
    invalidate,
    dispose: invalidate,
  };
}

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig();
  const controller = new ExternalAgentController({
    persistence: createWorkspaceExternalAgentPersistence(),
    credentials: getExternalAgentCredentialVault(),
    createClient: createExternalAgentClient,
    detectDriver: createExternalAgentDriverDetector(),
    getWorkspaceScope: () => getActiveWorkspaceId() ?? "local",
  });
  setExternalAgentController(controller);
  let disposed = false;
  const isDisposed = () => disposed;
  const cloudHostReconciler = createCloudHostReconciler({
    controller,
    fetch: (...args) => globalThis.fetch(...args),
    getActiveWorkspaceId,
    isEnabled: () =>
      runtimeConfig.public.ssrAuthEnabled === true &&
      runtimeConfig.public.connect?.enabled === true,
    isDisposed,
  });
  let controllerReady = false;
  const refreshCloudHostInventory = async (expectedWorkspaceId?: string) => {
    if (!controllerReady || disposed) return;
    await cloudHostReconciler.reconcile(expectedWorkspaceId);
  };
  setExternalAgentCloudHostRefresh(() => refreshCloudHostInventory());

  async function openSession(session: ExternalAgentSession) {
    const api = getGlobalMultiPaneApi();
    if (!api) throw new Error("Workspace pane host is unavailable");
    const recordId = encodeExternalAgentSessionRef({
      hostId: session.hostId,
      remoteSessionId: session.remoteSessionId,
    });
    const index = api.activePaneIndex.value;
    if (api.panes.value[index]) {
      await setExternalAgentPaneRecord(api, index, recordId);
      return;
    }
    await api.newPaneForApp(EXTERNAL_AGENT_PANE_APP_ID, {
      initialRecordId: recordId,
    });
  }

  async function openLauncher() {
    const api = getGlobalMultiPaneApi();
    if (!api) throw new Error("Workspace pane host is unavailable");
    const index = api.activePaneIndex.value;
    if (api.panes.value[index]) {
      await setExternalAgentPaneRecord(api, index, EXTERNAL_AGENT_LAUNCHER_REF);
      return;
    }
    await api.newPaneForApp(EXTERNAL_AGENT_PANE_APP_ID, {
      initialRecordId: EXTERNAL_AGENT_LAUNCHER_REF,
    });
  }

  const paneHandle = usePaneApps().registerPaneApp({
    id: EXTERNAL_AGENT_PANE_APP_ID,
    label: "External agent",
    icon: "lucide:bot",
    order: 82,
    replaceRecordInCurrentTab: true,
    component: () =>
      import("~/components/external-agents/ExternalAgentSessionPane.vue"),
  });
  const sidebarHandle = useSidebarPages().registerSidebarPage({
    id: EXTERNAL_AGENTS_SIDEBAR_PAGE_ID,
    label: "Agents",
    icon: "lucide:bot",
    order: 82,
    keepAlive: true,
    usesDefaultHeader: false,
    component: () =>
      import("~/components/external-agents/ExternalAgentsSidebarPage.vue"),
  });
  const activityHandle = getActivityRegistry().register(
    createExternalAgentActivitySource({ controller, openSession }),
  );
  const commandHandles = registerExternalAgentCommands({
    controller,
    openLauncher,
    openSession,
  });

  const reportReconcileError = () => {
    console.warn(
      "[external-agents] Could not load workspace connection preferences",
    );
  };
  const refreshCloudHostInventoryInBackground = () => {
    runExternalAgentBackground(
      () => refreshCloudHostInventory(),
      reportReconcileError,
      isDisposed,
    );
  };
  const stopWorkspaceSubscription = subscribeActiveWorkspaceDb((event) => {
    cloudHostReconciler.invalidate();
    runExternalAgentBackground(
      async () => {
        const workspaceId = event.newWorkspaceId ?? "local";
        await controller.reloadWorkspace(workspaceId);
        controllerReady = true;
        await refreshCloudHostInventory(workspaceId);
      },
      reportReconcileError,
      isDisposed,
    );
  });
  const sessionContext =
    runtimeConfig.public.ssrAuthEnabled === true ? useSessionContext() : null;
  const stopAuthSubscription = sessionContext
    ? watch(
        () => ({
          authenticated:
            sessionContext.data.value?.session?.authenticated ?? false,
          workspaceId:
            sessionContext.data.value?.session?.workspace?.id ?? null,
        }),
        (current, previous) => {
          if (
            current.authenticated &&
            (!previous?.authenticated ||
              current.workspaceId !== previous.workspaceId)
          ) {
            refreshCloudHostInventoryInBackground();
          }
        },
      )
    : () => undefined;
  const onVisibilityResume = () => {
    if (document.visibilityState === "visible") {
      refreshCloudHostInventoryInBackground();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityResume);
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cloudHostReconciler.dispose();
    stopWorkspaceSubscription();
    stopAuthSubscription();
    document.removeEventListener("visibilitychange", onVisibilityResume);
    controller.dispose();
    commandHandles.forEach((handle) => handle.dispose());
    activityHandle.dispose();
    sidebarHandle();
    paneHandle.dispose();
    setExternalAgentCloudHostRefresh(undefined);
    setExternalAgentController(undefined);
  };
  (
    nuxtApp.hook as unknown as (
      name: "app:beforeUnmount",
      callback: () => void,
    ) => void
  )("app:beforeUnmount", cleanup);
  if (import.meta.hot) {
    import.meta.hot.dispose(cleanup);
  }
  runExternalAgentBackground(
    async () => {
      const initialWorkspaceId = getActiveWorkspaceId() ?? "local";
      await controller.initialize(initialWorkspaceId);
      controllerReady = true;
      await refreshCloudHostInventory(initialWorkspaceId);
    },
    reportReconcileError,
    isDisposed,
  );
});
