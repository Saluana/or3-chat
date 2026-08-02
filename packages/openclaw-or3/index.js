import { Or3RunsBridge, createOr3RunsHttpHandler } from "./src/bridge.js";
import { resolveApprovalOverGateway } from "openclaw/plugin-sdk/approval-gateway-runtime";
import {
  callGatewayFromCli,
  GatewayClient,
} from "openclaw/plugin-sdk/gateway-runtime";

export default {
  id: "or3-runs",
  name: "OR3 Runs",
  description: "Connect OR3 Chat to OpenClaw's native agent lifecycle",
  register(api) {
    const agentId =
      typeof api.pluginConfig?.agentId === "string" &&
      api.pluginConfig.agentId.trim()
        ? api.pluginConfig.agentId.trim()
        : "main";
    const pluginToken =
      typeof api.pluginConfig?.token === "string"
        ? api.pluginConfig.token.trim()
        : "";
    const pluginOrigins = Array.isArray(api.pluginConfig?.allowedOrigins)
      ? api.pluginConfig.allowedOrigins.filter(
          (value) => typeof value === "string" && value.trim(),
        )
      : [];
    const resolveAccess = () => {
      const config = api.runtime.config.current();
      const gatewayToken = config.gateway?.auth?.token;
      return {
        token:
          pluginToken ||
          (typeof gatewayToken === "string" ? gatewayToken.trim() : "") ||
          process.env.OPENCLAW_GATEWAY_TOKEN?.trim() ||
          "",
        allowedOrigins:
          pluginOrigins.length > 0
            ? pluginOrigins
            : (config.gateway?.controlUi?.allowedOrigins ?? []),
      };
    };
    const gatewayRequest = (method, params, scopes, options = {}) =>
      callGatewayFromCli(
        method,
        { token: resolveAccess().token, expectFinal: false, ...options },
        params,
        { expectFinal: false, scopes },
      );
    let bridge;
    let eventClient;
    let eventReady;
    const ensureEventStream = () => {
      if (eventReady) return eventReady;
      const gatewayConfig = api.runtime.config.current().gateway ?? {};
      const gatewayPort = Number(
        process.env.OPENCLAW_GATEWAY_PORT ?? gatewayConfig.port ?? 18789,
      );
      let settled = false;
      let resolveReady;
      let rejectReady;
      eventReady = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const rejectConnection = (error) => {
        if (!settled) {
        settled = true;
        rejectReady(error);
        }
        eventReady = undefined;
        eventClient = undefined;
      };
      eventClient = new GatewayClient({
        url: `${gatewayConfig.tls?.enabled === true ? "wss" : "ws"}://127.0.0.1:${gatewayPort}`,
        token: resolveAccess().token,
        deviceIdentity: null,
        clientName: "gateway-client",
        clientDisplayName: "OR3 Runs",
        mode: "backend",
        role: "operator",
        scopes: ["operator.admin"],
        onEvent: (event) => {
          if (event.event === "chat") bridge.handleChatEvent(event.payload);
        },
        onHelloOk: () => {
          if (settled) return;
          settled = true;
          resolveReady();
        },
        onConnectError: (error) => {
          api.logger.warn(
            `OR3 event stream connection failed: ${error.message}`,
          );
          rejectConnection(error);
        },
        onClose: (code, reason) => {
          rejectConnection(
            new Error(`OR3 event stream closed (${code}): ${reason}`),
          );
        },
      });
      eventClient.start();
      return eventReady;
    };
    bridge = new Or3RunsBridge({
      agentId,
      control: {
        start: async (params) => {
          await ensureEventStream();
          return eventClient.request("chat.send", params, {
            expectFinal: false,
          });
        },
        wait: (params) =>
          gatewayRequest(
            "agent.wait",
            { ...params, timeoutMs: 60_000 },
            ["operator.write"],
            { timeout: "70000" },
          ),
        messages: (params) =>
          gatewayRequest("chat.history", params, ["operator.read"]),
        models: () =>
          gatewayRequest("models.list", { view: "configured" }, [
            "operator.read",
          ]),
        commands: (params) =>
          gatewayRequest(
            "commands.list",
            { ...params, includeArgs: true, scope: "text" },
            ["operator.read"],
          ),
        agents: () => gatewayRequest("agents.list", {}, ["operator.read"]),
        configure: ({ key, ...patch }) =>
          gatewayRequest("sessions.patch", { key, ...patch }, [
            "operator.admin",
            "operator.write",
          ]),
        createSession: (params) =>
          gatewayRequest("sessions.create", params, [
            "operator.admin",
            "operator.write",
          ]),
        stop: async (params) => {
          await ensureEventStream();
          return eventClient.request("chat.abort", params, {
            expectFinal: false,
          });
        },
        decide: ({ method, id, decision }) =>
          resolveApprovalOverGateway({
            cfg: api.runtime.config.current(),
            approvalId: id,
            decision,
            resolveMethod:
              method === "plugin.approval.resolve" ? "plugin" : undefined,
            allowPluginFallback: true,
            clientDisplayName: "OR3 Chat",
          }),
      },
    });

    api.lifecycle.registerRuntimeLifecycle({
      id: "or3-runs-chat-events",
      cleanup: async () => {
        const client = eventClient;
        eventClient = undefined;
        eventReady = undefined;
        await client?.stopAndWait().catch(() => client.stop());
      },
    });

    api.agent.events.registerAgentEventSubscription({
      id: "or3-runs-events",
      streams: ["tool", "approval"],
      handle: (event) => bridge.handleAgentEvent(event),
    });
    api.registerHttpRoute({
      path: "/or3",
      auth: "plugin",
      match: "prefix",
      handler: createOr3RunsHttpHandler(bridge, resolveAccess),
    });
  },
};

export { Or3RunsBridge, createOr3RunsHttpHandler };
