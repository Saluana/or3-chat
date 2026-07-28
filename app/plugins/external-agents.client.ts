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
  ExternalAgentClient,
  ExternalAgentClientFactory,
  ExternalAgentSession,
} from "~/core/external-agents/types";
import {
  getActiveWorkspaceId,
  subscribeActiveWorkspaceDb,
} from "~/db/client";
import { getGlobalMultiPaneApi } from "~/utils/multiPaneApi";

function adaptInternClient(client: InternClient): ExternalAgentClient {
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
      client.startTurn(sessionId, input, options),
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
}) =>
  adaptInternClient(
    createInternClient({
      baseUrl: host.baseUrl,
      resolveAuth: async () => {
        const token = await resolveCredential();
        return token ? { token } : null;
      },
      defaultTimeoutMs: 15_000,
      streamConnectTimeoutMs: 20_000,
    }),
  );

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
  const controller = new ExternalAgentController({
    persistence: createWorkspaceExternalAgentPersistence(),
    credentials: getExternalAgentCredentialVault(),
    createClient,
    getWorkspaceScope: () => getActiveWorkspaceId() ?? "local",
  });
  setExternalAgentController(controller);

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
    () => controller.initialize(getActiveWorkspaceId() ?? "local"),
    () => {
      console.warn(
        "[external-agents] Could not load workspace connection preferences",
      );
    },
    isDisposed,
  );
});
