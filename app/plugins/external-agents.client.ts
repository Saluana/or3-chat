import { createInternClient, type InternClient } from "@or3/intern-client";
import { usePaneApps } from "~/composables/core/usePaneApps";
import { useSidebarPages } from "~/composables/sidebar/useSidebarPages";
import { getActivityRegistry } from "~/core/activity/registry";
import { createExternalAgentActivitySource } from "~/core/external-agents/activity-adapter";
import { registerExternalAgentCommands } from "~/core/external-agents/commands";
import { ExternalAgentController } from "~/core/external-agents/controller";
import { getExternalAgentCredentialVault } from "~/core/external-agents/credentials";
import { createWorkspaceExternalAgentPersistence } from "~/core/external-agents/persistence";
import {
  encodeExternalAgentSessionRef,
  EXTERNAL_AGENT_LAUNCHER_REF,
  EXTERNAL_AGENT_PANE_APP_ID,
  EXTERNAL_AGENTS_SIDEBAR_PAGE_ID,
} from "~/core/external-agents/refs";
import { setExternalAgentController } from "~/core/external-agents/runtime";
import type {
  ExternalAgentAttachment,
  ExternalAgentClient,
  ExternalAgentClientFactory,
  ExternalAgentSession,
  ExternalAgentUploadAttachment,
} from "~/core/external-agents/types";
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

const createClient: ExternalAgentClientFactory = ({
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
        return token ? { token } : null;
      },
      defaultTimeoutMs: 15_000,
      streamConnectTimeoutMs: 20_000,
    }),
  );
};

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

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig();
  const controller = new ExternalAgentController({
    persistence: createWorkspaceExternalAgentPersistence(),
    credentials: getExternalAgentCredentialVault(),
    createClient,
    getWorkspaceScope: () => getActiveWorkspaceId() ?? "local",
  });
  setExternalAgentController(controller);

  async function hydrateCloudHosts() {
    if (
      runtimeConfig.public.ssrAuthEnabled !== true ||
      runtimeConfig.public.connect?.enabled !== true
    ) {
      return;
    }
    let response: {
      environments?: Array<{
        id: string;
        name: string;
        baseUrl: string;
        accessToken: string;
      }>;
    };
    try {
      const result = await globalThis.fetch("/api/connect/environments", {
        credentials: "include",
        cache: "no-store",
      });
      if (!result.ok) return;
      response = (await result.json()) as typeof response;
    } catch {
      // Offline/static installs intentionally have no OR3 Cloud environment API.
      return;
    }
    const environments = response.environments ?? [];
    for (const [index, environment] of environments.entries()) {
      if (
        !environment.name ||
        !environment.baseUrl ||
        !environment.accessToken
      ) {
        continue;
      }
      try {
        await controller.restoreCloudHost({
          environmentId: environment.id,
          name: environment.name,
          baseUrl: environment.baseUrl,
          token: environment.accessToken,
          activate:
            controller.snapshot.activeHostId === null && index === 0,
        });
      } catch {
        // Keep the environment in Cloud even when its computer is asleep.
      }
    }
  }

  async function openSession(session: ExternalAgentSession) {
    const api = getGlobalMultiPaneApi();
    if (!api) throw new Error("Workspace pane host is unavailable");
    const recordId = encodeExternalAgentSessionRef({
      hostId: session.hostId,
      remoteSessionId: session.remoteSessionId,
    });
    const index = api.activePaneIndex.value;
    if (api.panes.value[index]) {
      await api.setPaneApp(index, EXTERNAL_AGENT_PANE_APP_ID, { recordId });
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
      await api.setPaneApp(index, EXTERNAL_AGENT_PANE_APP_ID, {
        recordId: EXTERNAL_AGENT_LAUNCHER_REF,
      });
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

  let disposed = false;
  const isDisposed = () => disposed;
  const stopWorkspaceSubscription = subscribeActiveWorkspaceDb((event) => {
    runExternalAgentBackground(
      () => controller.reloadWorkspace(event.newWorkspaceId ?? "local"),
      () => {
        console.warn(
          "[external-agents] Could not load workspace connection preferences",
        );
      },
      isDisposed,
    );
  });
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    stopWorkspaceSubscription();
    controller.dispose();
    commandHandles.forEach((handle) => handle.dispose());
    activityHandle.dispose();
    sidebarHandle();
    paneHandle.dispose();
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
      await controller.initialize(getActiveWorkspaceId() ?? "local");
      await hydrateCloudHosts();
    },
    () => {
      console.warn(
        "[external-agents] Could not load workspace connection preferences",
      );
    },
    isDisposed,
  );
});
