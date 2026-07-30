import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineComponent, h, shallowRef } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExternalAgentsSidebarPage from "../ExternalAgentsSidebarPage.vue";
import ExternalAgentSessionPane from "../ExternalAgentSessionPane.vue";
import ExternalAgentLauncher from "../ExternalAgentLauncher.vue";
import { encodeExternalAgentSessionRef } from "~/core/external-agents/refs";
import { CORE_APP_COMPONENT_DEFAULTS } from "~/theme/_shared/theme-components-registry";
import type { ThemePlugin } from "~/plugins/90.theme.client";
import type {
  ExternalAgentSession,
  ExternalAgentStoreSnapshot,
} from "~/core/external-agents/types";

const mocks = vi.hoisted(() => ({
  controller: {
    availableRunnerOptions: vi.fn(),
    addTrustedHost: vi.fn(),
    reconnect: vi.fn(),
    unlockCredentials: vi.fn(),
    isHostCredentialLocked: vi.fn(),
    unlockHostCredential: vi.fn(),
    lockCredentials: vi.fn(),
    clearActiveHostCredential: vi.fn(),
    switchHost: vi.fn(),
    disconnect: vi.fn(),
    forgetHost: vi.fn(),
    launch: vi.fn(),
    ensureSession: vi.fn(),
    cancel: vi.fn(),
    decideApproval: vi.fn(),
    followUp: vi.fn(),
    readArtifact: vi.fn(),
    canCancel: vi.fn(),
    canDecideApproval: vi.fn(),
    canFollowUp: vi.fn(),
    canReadArtifact: vi.fn(),
    pinCredentialStatus: {
      supported: true as const,
      configured: false,
      locked: false,
      persistedCredentialCount: 0,
    },
    snapshot: null as ExternalAgentStoreSnapshot | null,
  },
  snapshot: null as unknown as ReturnType<
    typeof shallowRef<ExternalAgentStoreSnapshot | null>
  >,
  refreshCloudHosts: vi.fn(),
  newPaneForApp: vi.fn(),
  setPaneApp: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

vi.mock("~/core/external-agents/runtime", () => ({
  useExternalAgentRuntime: () => ({
    controller: mocks.controller,
    refreshCloudHosts: mocks.refreshCloudHosts,
    snapshot: mocks.snapshot,
  }),
}));

vi.mock("~/utils/multiPaneApi", () => ({
  getGlobalMultiPaneApi: () => ({
    panes: shallowRef([{ id: "pane-1" }]),
    activePaneIndex: shallowRef(0),
    newPaneForApp: mocks.newPaneForApp,
    setPaneApp: mocks.setPaneApp,
  }),
}));

vi.mock("~/composables/sidebar/useActiveSidebarPage", () => ({
  useActiveSidebarPage: () => ({
    setActivePage: vi.fn(),
  }),
}));

const session: ExternalAgentSession = {
  hostId: "host-1",
  hostGeneration: 1,
  remoteSessionId: "session-1",
  appSessionKey: "app-session-1",
  runnerId: "codex",
  title: "Fix mobile layout",
  status: "waiting_approval",
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:01:00.000Z",
  activeTurnId: "turn-1",
  output: "Complete output",
  error: "A recoverable warning",
  streamState: "disconnected",
  turns: [],
  events: [
    {
      id: "event-1",
      hostId: "host-1",
      hostGeneration: 1,
      sessionId: "session-1",
      turnId: "turn-1",
      sequence: 1,
      occurredAt: "2026-07-27T00:00:30.000Z",
      type: "tool",
      text: "Edited app.vue",
      payload: {},
    },
  ],
  approvals: [
    {
      id: "approval-1",
      turnId: "turn-1",
      title: "Allow edit",
      description: "Write app.vue",
      status: "pending",
    },
  ],
  artifacts: [
    {
      id: "artifact-1",
      turnId: "turn-1",
      kind: "diff",
      label: "app.vue",
      content: "+ responsive",
    },
    {
      id: "artifact-2",
      turnId: "turn-1",
      kind: "artifact",
      label: "Build log",
      artifactId: "remote-artifact-2",
    },
  ],
};

function snapshot(
  overrides: Partial<ExternalAgentStoreSnapshot> = {},
): ExternalAgentStoreSnapshot {
  return {
    hosts: [
      {
        id: "host-1",
        name: "Laptop",
        baseUrl: "https://host.test",
        credentialRef: "credential",
        trustedAt: "2026-07-27T00:00:00.000Z",
      },
    ],
    activeHostId: "host-1",
    connectionState: "degraded",
    connectionError: "Capability discovery is incomplete.",
    generation: 1,
    health: { status: "ok", runtimeAvailable: true },
    readiness: null,
    capabilities: null,
    runners: [
      {
        id: "codex",
        display_name: "Codex",
        status: "available",
        auth_status: "ready",
        supports: {
          chat: { chatSelectable: true, chatReplay: true },
        },
        models: [],
        workspace_roots: ["/workspace"],
        default_cwd: "/workspace",
      },
    ],
    sessions: [session],
    sessionRefs: [],
    ...overrides,
  };
}

const ButtonStub = defineComponent({
  inheritAttrs: false,
  emits: ["click"],
  setup(_, { attrs, emit, slots }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: attrs.type as string,
          disabled: attrs.disabled as boolean,
          onClick: () => emit("click"),
        },
        slots.default?.(),
      );
  },
});
const InputStub = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) =>
          emit("update:modelValue", (event.target as HTMLInputElement).value),
      });
  },
});
const TextareaStub = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("textarea", {
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) =>
          emit(
            "update:modelValue",
            (event.target as HTMLTextAreaElement).value,
          ),
      });
  },
});
const SelectStub = defineComponent({
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: "" },
    items: { type: Array, default: () => [] },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h(
        "select",
        {
          ...attrs,
          value: props.modelValue,
          onChange: (event: Event) =>
            emit(
              "update:modelValue",
              (event.target as HTMLSelectElement).value,
            ),
        },
        (props.items as Array<{ value: string; label: string }>).map((item) =>
          h("option", { value: item.value }, item.label),
        ),
      );
  },
});
const CheckboxStub = defineComponent({
  inheritAttrs: false,
  props: { modelValue: Boolean, label: String },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("label", [
        h("input", {
          ...attrs,
          type: "checkbox",
          checked: props.modelValue,
          onChange: (event: Event) =>
            emit(
              "update:modelValue",
              (event.target as HTMLInputElement).checked,
            ),
        }),
        props.label,
      ]);
  },
});
const BadgeStub = defineComponent({
  setup(_, { slots }) {
    return () => h("span", slots.default?.());
  },
});
const AlertStub = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs }) {
    return () =>
      h(
        "div",
        `${String(attrs.title ?? "")} ${String(attrs.description ?? "")}`,
      );
  },
});
const LauncherStub = defineComponent({
  emits: ["launched"],
  setup() {
    return () => h("div", "Launcher");
  },
});
const SlotStub = defineComponent({
  setup(_, { slots }) {
    return () =>
      h("div", [slots.default?.(), slots.content?.(), slots.body?.()]);
  },
});
const EmptyStateStub = defineComponent({
  props: { title: String, description: String },
  setup(props, { slots }) {
    return () => h("div", [props.title, props.description, slots.actions?.()]);
  },
});
const GroupHeaderStub = defineComponent({
  props: { label: String },
  emits: ["toggle"],
  setup(props) {
    return () => h("div", props.label);
  },
});
const ChatMessageStub = defineComponent({
  props: { message: { type: Object, required: true } },
  setup(props) {
    return () =>
      h("div", [
        String((props.message as { text?: string }).text ?? ""),
        ...(
          (props.message as { toolCalls?: Array<{ name: string }> })
            .toolCalls ?? []
        ).map((tool) => tool.name),
      ]);
  },
});

const global = {
  stubs: {
    UButton: ButtonStub,
    UInput: InputStub,
    UTextarea: TextareaStub,
    USelectMenu: SelectStub,
    UCheckbox: CheckboxStub,
    UBadge: BadgeStub,
    UAlert: AlertStub,
    UIcon: true,
    UTooltip: SlotStub,
    UPopover: SlotStub,
    UModal: SlotStub,
    ClientOnly: SlotStub,
    SidebarEmptyState: EmptyStateStub,
    SidebarGroupHeader: GroupHeaderStub,
    ChatMessage: ChatMessageStub,
    ExternalAgentLauncher: LauncherStub,
  },
};

describe("External Agents components", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const value = snapshot();
    mocks.snapshot = shallowRef(value);
    mocks.controller.snapshot = value;
    mocks.controller.availableRunnerOptions.mockReturnValue([
      {
        runner: {
          id: "codex",
          display_name: "Codex",
          models: [],
        },
        available: true,
        modes: [
          {
            id: "review",
            label: "Review only",
            dangerous: false,
          },
        ],
        isolations: [
          {
            id: "host_readonly",
            label: "Read only",
            dangerous: false,
          },
        ],
        roots: ["/workspace"],
        defaultMode: "review",
        defaultIsolation: "host_readonly",
        defaultCwd: "/workspace",
      },
    ]);
    mocks.controller.reconnect.mockResolvedValue(true);
    mocks.controller.unlockCredentials.mockResolvedValue(undefined);
    mocks.controller.isHostCredentialLocked.mockReturnValue(false);
    mocks.controller.unlockHostCredential.mockResolvedValue(true);
    mocks.controller.clearActiveHostCredential.mockResolvedValue(undefined);
    mocks.controller.forgetHost.mockResolvedValue(undefined);
    mocks.refreshCloudHosts.mockResolvedValue(undefined);
    mocks.controller.pinCredentialStatus = {
      supported: true,
      configured: false,
      locked: false,
      persistedCredentialCount: 0,
    };
    mocks.controller.launch.mockResolvedValue(session);
    mocks.controller.ensureSession.mockResolvedValue(session);
    mocks.controller.canCancel.mockReturnValue(true);
    mocks.controller.canDecideApproval.mockReturnValue(true);
    mocks.controller.canFollowUp.mockReturnValue(true);
    mocks.controller.canReadArtifact.mockReturnValue(true);
  });

  it("prioritizes searchable, time-grouped history and keeps connection management secondary", async () => {
    const wrapper = mount(ExternalAgentsSidebarPage, { global });
    await flushPromises();

    expect(wrapper.text()).not.toContain("limited availability");
    expect(wrapper.text()).toContain("New agent");
    expect(wrapper.find('[aria-label="Search agent sessions"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain("Connect another computer");
    expect(wrapper.text()).toContain("npx @or3/connect");
    expect(wrapper.text()).toContain(
      "Advanced: add another host by URL and token",
    );
    expect(wrapper.text()).toContain("Fix mobile layout");
    expect(wrapper.find("section").classes()).toContain("flex");
  });

  it("opens a session in the active pane", async () => {
    const wrapper = mount(ExternalAgentsSidebarPage, { global });
    await flushPromises();

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Fix mobile layout"))
      ?.trigger("click");

    expect(mocks.setPaneApp).toHaveBeenCalledWith(0, "or3-external-agent", {
      recordId: encodeExternalAgentSessionRef({
        hostId: "host-1",
        remoteSessionId: "session-1",
      }),
    });
    expect(mocks.newPaneForApp).not.toHaveBeenCalled();
  });

  it("offers opt-in PIN encryption with an explicit offline-attack warning", async () => {
    const wrapper = mount(ExternalAgentsSidebarPage, { global });
    await flushPromises();

    await wrapper.find('input[type="checkbox"]').setValue(true);
    await flushPromises();

    expect(wrapper.text()).toContain("Local encrypted storage");
    expect(wrapper.text()).toContain("may be brute-forced");
    expect(wrapper.find('[aria-label="Credential PIN"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Confirm credential PIN"]').exists()).toBe(
      true,
    );
  });

  it("passes the confirmed PIN only when persistent token storage is selected", async () => {
    const wrapper = mount(ExternalAgentsSidebarPage, { global });
    await flushPromises();

    await wrapper.find('input[placeholder="Host name"]').setValue("Laptop");
    await wrapper
      .find('input[placeholder="http://127.0.0.1:9100"]')
      .setValue("http://127.0.0.1:9100");
    await wrapper
      .find('input[placeholder="Access token"]')
      .setValue("agent-token");
    await wrapper.find('input[type="checkbox"]').setValue(true);
    await wrapper.find('[aria-label="Credential PIN"]').setValue("482915");
    await wrapper
      .find('[aria-label="Confirm credential PIN"]')
      .setValue("482915");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mocks.controller.addTrustedHost).toHaveBeenCalledWith({
      name: "Laptop",
      baseUrl: "http://127.0.0.1:9100",
      token: "agent-token",
      persistencePin: "482915",
    });
  });

  it("recovers a session-only credential inside the selected host card", async () => {
    const value = snapshot({
      connectionState: "disconnected",
      connectionError:
        "A credential is required to reconnect this trusted host.",
    });
    mocks.snapshot = shallowRef(value);
    mocks.controller.snapshot = value;
    const wrapper = mount(ExternalAgentsSidebarPage, { global });
    await flushPromises();

    const reauthForm = wrapper.find(
      'form[aria-label="Reconnect trusted host"]',
    );
    expect(reauthForm.exists()).toBe(true);
    expect(reauthForm.text()).toContain("updates only the selected trusted host");
    await reauthForm
      .find('[aria-label="Token for selected host"]')
      .setValue("replacement-token");
    await reauthForm.trigger("submit");
    await flushPromises();

    expect(mocks.controller.reconnect).toHaveBeenCalledWith(
      "replacement-token",
      undefined,
    );
    expect(mocks.controller.addTrustedHost).not.toHaveBeenCalled();
  });

  it("unlocks a saved token with the PIN before reconnecting", async () => {
    const value = snapshot({
      connectionState: "disconnected",
      connectionError: "Saved agent credentials are locked.",
    });
    mocks.snapshot = shallowRef(value);
    mocks.controller.snapshot = value;
    mocks.controller.pinCredentialStatus = {
      supported: true,
      configured: true,
      locked: true,
      persistedCredentialCount: 1,
    };
    const wrapper = mount(ExternalAgentsSidebarPage, { global });
    await flushPromises();

    await wrapper.find('[aria-label="Device PIN"]').setValue("482915");
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Unlock and reconnect"))
      ?.trigger("click");
    await flushPromises();

    expect(mocks.controller.unlockCredentials).toHaveBeenCalledWith("482915");
    expect(mocks.controller.reconnect).toHaveBeenCalledWith();
  });

  it("reconciles cloud inventory before the explicit host refresh", async () => {
    const wrapper = mount(ExternalAgentsSidebarPage, { global });
    await flushPromises();

    await wrapper
      .findAll("button")
      .find((button) => button.text().trim() === "Refresh")
      ?.trigger("click");
    await flushPromises();

    expect(mocks.refreshCloudHosts).toHaveBeenCalledOnce();
    expect(mocks.controller.reconnect).toHaveBeenCalledOnce();
    expect(
      mocks.refreshCloudHosts.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.controller.reconnect.mock.invocationCallOrder[0]!);
  });

  it("labels going offline as local-only and keeps cloud access intact", async () => {
    const value = snapshot({
      hosts: [
        {
          id: "or3-connect:environment-a",
          name: "Studio Mac",
          baseUrl: "https://studio.connect.example.test",
          credentialRef: "or3-connect-credential:environment-a",
          trustedAt: "2026-07-27T00:00:00.000Z",
        },
      ],
      activeHostId: "or3-connect:environment-a",
      connectionState: "online",
      connectionError: null,
    });
    mocks.snapshot = shallowRef(value);
    mocks.controller.snapshot = value;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(ExternalAgentsSidebarPage, { global });
    await flushPromises();

    expect(wrapper.text()).toContain("Go offline for now");
    expect(wrapper.text()).toContain(
      "The computer stays linked to this workspace until you remove it",
    );
    await wrapper
      .findAll("button")
      .find((button) => button.text().trim() === "Go offline for now")
      ?.trigger("click");

    expect(mocks.controller.disconnect).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.controller.forgetHost).not.toHaveBeenCalled();
    expect(mocks.refreshCloudHosts).not.toHaveBeenCalled();
  });

  it("confirms cloud revocation before reconciling local metadata", async () => {
    const value = snapshot({
      hosts: [
        {
          id: "or3-connect:environment-a",
          name: "Studio Mac",
          baseUrl: "https://studio.connect.example.test",
          credentialRef: "or3-connect-credential:environment-a",
          trustedAt: "2026-07-27T00:00:00.000Z",
        },
      ],
      activeHostId: "or3-connect:environment-a",
      connectionState: "offline",
      connectionError: "Computer is asleep.",
    });
    mocks.snapshot = shallowRef(value);
    mocks.controller.snapshot = value;
    const response = deferred<Response>();
    const fetchMock = vi.fn(() => response.promise);
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(ExternalAgentsSidebarPage, { global });
    await flushPromises();

    await wrapper
      .findAll("button")
      .find((button) => button.text().trim() === "Remove computer")
      ?.trigger("click");
    expect(
      wrapper.find('[data-testid="cloud-computer-removal-confirmation"]').text(),
    ).toContain("revokes this workspace's remote access");

    await wrapper
      .findAll("button")
      .find(
        (button) => button.text().trim() === "Remove and revoke access",
      )
      ?.trigger("click");
    await flushPromises();

    expect(mocks.refreshCloudHosts).not.toHaveBeenCalled();
    expect(mocks.controller.forgetHost).not.toHaveBeenCalled();
    response.resolve({ ok: true } as Response);
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/connect/environments/remove",
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Or3-Connect-Intent": "remove",
        },
        body: JSON.stringify({ environmentId: "environment-a" }),
      },
    );
    expect(mocks.refreshCloudHosts).toHaveBeenCalledOnce();
    expect(mocks.controller.forgetHost).not.toHaveBeenCalled();
  });

  it("keeps a cloud computer visible when revocation is not confirmed", async () => {
    const value = snapshot({
      hosts: [
        {
          id: "or3-connect:environment-a",
          name: "Studio Mac",
          baseUrl: "https://studio.connect.example.test",
          credentialRef: "or3-connect-credential:environment-a",
          trustedAt: "2026-07-27T00:00:00.000Z",
        },
      ],
      activeHostId: "or3-connect:environment-a",
      connectionState: "offline",
    });
    mocks.snapshot = shallowRef(value);
    mocks.controller.snapshot = value;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ statusMessage: "Relay cleanup is unavailable." }),
      })),
    );
    const wrapper = mount(ExternalAgentsSidebarPage, { global });
    await flushPromises();

    await wrapper
      .findAll("button")
      .find((button) => button.text().trim() === "Remove computer")
      ?.trigger("click");
    await wrapper
      .findAll("button")
      .find(
        (button) => button.text().trim() === "Remove and revoke access",
      )
      ?.trigger("click");
    await flushPromises();

    expect(
      wrapper.find('[data-testid="cloud-computer-removal-confirmation"]').text(),
    ).toContain("Relay cleanup is unavailable.");
    expect(mocks.refreshCloudHosts).not.toHaveBeenCalled();
    expect(mocks.controller.forgetHost).not.toHaveBeenCalled();
  });

  it("renders offline recovery states in both sidebar and session pane", async () => {
    const value = snapshot({
      connectionState: "offline",
      connectionError: "Host could not be reached.",
    });
    mocks.snapshot = shallowRef(value);
    mocks.controller.snapshot = value;

    const sidebar = mount(ExternalAgentsSidebarPage, { global });
    const pane = mount(ExternalAgentSessionPane, {
      props: {
        paneId: "pane-1",
        recordId: encodeExternalAgentSessionRef({
          hostId: "host-1",
          remoteSessionId: "session-1",
        }),
      },
      global,
    });
    await flushPromises();

    expect(sidebar.text()).toContain("Host could not be reached");
    expect(sidebar.text()).toContain("Host could not be reached");
    expect(pane.text()).toContain("Host disconnected");
    expect(pane.text()).toContain("Reconnect the host to continue");
  });

  it("retries a historical conversation after reconnect and repairs its stale host reference", async () => {
    const disconnected = snapshot({
      connectionState: "disconnected",
      sessions: [],
    });
    mocks.snapshot = shallowRef(disconnected);
    mocks.controller.snapshot = disconnected;
    mocks.controller.ensureSession
      .mockRejectedValueOnce(
        new Error("Connect a trusted or3-intern host first"),
      )
      .mockResolvedValueOnce(session);
    const wrapper = mount(ExternalAgentSessionPane, {
      props: {
        paneId: "pane-1",
        recordId: encodeExternalAgentSessionRef({
          hostId: "older-host-identity",
          remoteSessionId: "session-1",
        }),
      },
      global,
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Conversation temporarily offline");

    mocks.snapshot.value = snapshot({
      connectionState: "online",
      sessions: [],
    });
    await flushPromises();

    expect(mocks.controller.ensureSession).toHaveBeenCalledTimes(2);
    expect(mocks.setPaneApp).toHaveBeenCalledWith(0, "or3-external-agent", {
      recordId: encodeExternalAgentSessionRef({
        hostId: "host-1",
        remoteSessionId: "session-1",
      }),
    });
    expect(
      wrapper.find('[data-testid="conversation-load-recovery"]').exists(),
    ).toBe(false);
  });

  it("offers retry and reconnect inline for an offline conversation", async () => {
    const value = snapshot({
      connectionState: "offline",
      sessions: [],
    });
    mocks.snapshot = shallowRef(value);
    mocks.controller.snapshot = value;
    mocks.controller.ensureSession.mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    const wrapper = mount(ExternalAgentSessionPane, {
      props: {
        paneId: "pane-1",
        recordId: encodeExternalAgentSessionRef({
          hostId: "host-1",
          remoteSessionId: "session-1",
        }),
      },
      global,
    });
    await flushPromises();

    const recovery = wrapper.find(
      '[data-testid="conversation-load-recovery"]',
    );
    expect(recovery.text()).toContain("Conversation temporarily offline");
    expect(recovery.text()).toContain("Retry");
    expect(recovery.text()).toContain("Reconnect host");
    await recovery
      .findAll("button")
      .find((button) => button.text() === "Reconnect host")
      ?.trigger("click");
    await flushPromises();
    expect(mocks.controller.reconnect).toHaveBeenCalled();
  });

  it.each([
    {
      name: "unauthorized",
      error: new Error("Access token is unauthorized"),
      title: "This host needs its access token",
      settings: true,
    },
    {
      name: "stale host",
      error: new Error("Trusted host was not found"),
      title: "The saved host changed",
      settings: true,
    },
    {
      name: "transient server error",
      error: new Error("Service is temporarily unavailable"),
      title: "Conversation unavailable",
      settings: false,
    },
  ])(
    "maps $name to an actionable in-pane recovery",
    async ({ error, title, settings }) => {
      const value = snapshot({
        connectionState: "online",
        sessions: [],
      });
      mocks.snapshot = shallowRef(value);
      mocks.controller.snapshot = value;
      mocks.controller.ensureSession.mockRejectedValue(error);
      const wrapper = mount(ExternalAgentSessionPane, {
        props: {
          paneId: "pane-1",
          recordId: encodeExternalAgentSessionRef({
            hostId: "host-1",
            remoteSessionId: "session-1",
          }),
        },
        global,
      });
      await flushPromises();

      const recovery = wrapper.find(
        '[data-testid="conversation-load-recovery"]',
      );
      expect(recovery.text()).toContain(title);
      expect(recovery.text()).toContain("Retry");
      expect(recovery.text().includes("Open connection settings")).toBe(
        settings,
      );
    },
  );

  it("unlocks the historical conversation host from its own pane", async () => {
    const targetSession = {
      ...session,
      hostId: "host-2",
      remoteSessionId: "session-2",
    };
    const disconnected = snapshot({
      hosts: [
        ...snapshot().hosts,
        {
          id: "host-2",
          name: "Studio Mac",
          baseUrl: "https://studio.test",
          credentialRef: "studio-credential",
          trustedAt: "2026-07-27T00:00:00.000Z",
        },
      ],
      activeHostId: "host-1",
      connectionState: "disconnected",
      sessions: [],
    });
    mocks.snapshot = shallowRef(disconnected);
    mocks.controller.snapshot = disconnected;
    mocks.controller.isHostCredentialLocked.mockImplementation(
      (hostId: string) => hostId === "host-2",
    );
    mocks.controller.unlockHostCredential.mockImplementation(async () => {
      mocks.controller.isHostCredentialLocked.mockReturnValue(false);
      return true;
    });
    mocks.controller.ensureSession.mockResolvedValue(targetSession);

    const wrapper = mount(ExternalAgentSessionPane, {
      props: {
        paneId: "pane-1",
        recordId: encodeExternalAgentSessionRef({
          hostId: "host-2",
          remoteSessionId: "session-2",
        }),
      },
      global,
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Unlock this conversation");
    expect(wrapper.text()).toContain("Studio Mac");
    expect(wrapper.text()).not.toContain("Conversation unavailable");
    expect(mocks.controller.ensureSession).not.toHaveBeenCalled();

    await wrapper.find('[aria-label="Conversation PIN"]').setValue("482915");
    await wrapper
      .find('form[aria-label="Unlock agent conversation"]')
      .trigger("submit");
    await flushPromises();

    expect(mocks.controller.unlockHostCredential).toHaveBeenCalledWith(
      "host-2",
      "482915",
      "session-2",
    );
    expect(mocks.controller.ensureSession).toHaveBeenCalledWith(
      "host-2",
      "session-2",
    );
  });

  it("renders a conversation with compact activity, files, approvals, redacted errors and real actions", async () => {
    const wrapper = mount(ExternalAgentSessionPane, {
      props: {
        paneId: "pane-1",
        recordId: encodeExternalAgentSessionRef({
          hostId: "host-1",
          remoteSessionId: "session-1",
        }),
      },
      global,
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Edited app.vue");
    expect(wrapper.text()).toContain("+ responsive");
    expect(wrapper.text()).toContain("Allow edit");
    expect(wrapper.text()).toContain("A recoverable warning");
    expect(wrapper.text()).not.toContain("Timeline");
    expect(wrapper.text()).not.toContain("session-1");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Approve")
      ?.trigger("click");
    expect(mocks.controller.decideApproval).toHaveBeenCalledWith(
      "session-1",
      "approve",
      "approval-1",
    );

    await wrapper.find('[aria-label="Stop agent"]').trigger("click");
    expect(mocks.controller.cancel).toHaveBeenCalledWith("session-1");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Load")
      ?.trigger("click");
    expect(mocks.controller.readArtifact).toHaveBeenCalledWith(
      "session-1",
      "artifact-2",
    );
  });

  it("renders agent prose through the active chat-message theme component and main-chat row geometry", async () => {
    const formattedSession: ExternalAgentSession = {
      ...session,
      status: "succeeded",
      activeTurnId: undefined,
      approvals: [],
      artifacts: [],
      error: undefined,
      turns: [
        {
          id: "turn-formatted",
          session_id: "session-1",
          sequence: 1,
          status: "succeeded",
          continuation_mode: "replay",
          requested_at: Date.now() - 1_000,
          completed_at: Date.now(),
          user_message: "Explain the formatter",
          final_text: "## Result\n\nUse **shared prose**.",
        },
      ],
    };
    mocks.snapshot.value = snapshot({ sessions: [formattedSession] });
    const ThemedMessage = defineComponent({
      props: { message: { type: Object, required: true } },
      setup(props) {
        return () =>
          h(
            "div",
            { class: "active-theme-chat-message" },
            String((props.message as { text?: string }).text ?? ""),
          );
      },
    });
    const wrapper = mount(ExternalAgentSessionPane, {
      props: {
        paneId: "pane-1",
        recordId: encodeExternalAgentSessionRef({
          hostId: "host-1",
          remoteSessionId: "session-1",
        }),
      },
      global: {
        ...global,
        config: {
          globalProperties: {
            $theme: {
              activeComponents: shallowRef({
                ...CORE_APP_COMPONENT_DEFAULTS,
                "chat-message": ThemedMessage,
              }),
            } as unknown as ThemePlugin,
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.findAll(".active-theme-chat-message")).toHaveLength(2);
    const rows = wrapper.findAll(".messages-container");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.classes()).toEqual(
        expect.arrayContaining([
          "mx-auto",
          "w-full",
          "min-w-0",
          "break-words",
          "px-1.5",
          "pb-6",
          "sm:max-w-[768px]",
        ]),
      );
    }
  });

  it("keeps turn settings available after launch while locking the runner", async () => {
    const completedSession: ExternalAgentSession = {
      ...session,
      status: "succeeded",
      mode: "review",
      isolation: "host_readonly",
      cwd: "/workspace",
      model: "gpt-5.6-luna",
      activeTurnId: undefined,
      approvals: [],
      turns: [
        {
          id: "turn-1",
          session_id: "session-1",
          sequence: 1,
          status: "succeeded",
          continuation_mode: "replay",
          requested_at: Date.now() - 1_000,
          completed_at: Date.now(),
          user_message: "Initial request",
          final_text: "Done",
          mode: "review",
          isolation: "host_readonly",
          cwd: "/workspace",
          model: "gpt-5.6-luna",
        },
      ],
    };
    mocks.snapshot.value = snapshot({
      sessions: [completedSession],
      runners: [
        {
          id: "codex",
          display_name: "Codex",
          status: "available",
          auth_status: "ready",
          supports: {
            chat: { chatSelectable: true, chatReplay: true },
          },
          models: [
            { id: "gpt-5.6-luna", display_name: "GPT-5.6 Luna" },
            {
              id: "gpt-5.6-sol",
              display_name: "GPT-5.6 Sol",
              reasoning: ["low", "medium", "high", "xhigh"],
              reasoning_default: "medium",
            },
          ],
          workspace_roots: ["/workspace"],
          default_cwd: "/workspace",
        },
      ],
    });

    const wrapper = mount(ExternalAgentSessionPane, {
      props: {
        paneId: "pane-1",
        recordId: encodeExternalAgentSessionRef({
          hostId: "host-1",
          remoteSessionId: "session-1",
        }),
      },
      global,
    });
    await flushPromises();

    const runnerSelect = wrapper.find(
      'select[aria-label="External agent provider"]',
    );
    expect(runnerSelect.exists()).toBe(true);
    expect(runnerSelect.attributes("disabled")).toBeDefined();

    await wrapper
      .find('select[aria-label="External agent model"]')
      .setValue("gpt-5.6-sol");
    await wrapper
      .find('select[aria-label="External agent reasoning level"]')
      .setValue("high");
    await wrapper
      .find('textarea[aria-label="Message the agent"]')
      .setValue("Try a stronger model");
    await wrapper.find('form[aria-label="Agent composer"]').trigger("submit");
    await flushPromises();

    expect(mocks.controller.followUp).toHaveBeenCalledWith("session-1", {
      instruction: "Try a stronger model",
      cwd: "/workspace",
      mode: "review",
      isolation: "host_readonly",
      model: "gpt-5.6-sol",
      thinkingLevel: "high",
      confirmDangerous: false,
    });
  });

  it("launches only through the controller using advertised provider values", async () => {
    const launcherGlobal = {
      ...global,
      stubs: {
        ...global.stubs,
        ExternalAgentLauncher: false,
      },
    };
    const wrapper = mount(ExternalAgentLauncher, {
      global: launcherGlobal,
    });
    await flushPromises();
    await wrapper.find("textarea").setValue("Review the router");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mocks.controller.launch).toHaveBeenCalledWith({
      runnerId: "codex",
      instruction: "Review the router",
      cwd: "/workspace",
      mode: "review",
      isolation: "host_readonly",
      model: undefined,
      confirmDangerous: false,
    });
    expect(wrapper.emitted("launched")?.[0]?.[0]).toBe(session);
  });

  it("gives a first-time user the Connect command instead of a dead end", async () => {
    mocks.snapshot.value = snapshot({
      hosts: [],
      activeHostId: null,
      connectionState: "disconnected",
      runners: [],
      sessions: [],
    });
    const wrapper = mount(ExternalAgentLauncher, {
      global: {
        ...global,
        stubs: {
          ...global.stubs,
          ExternalAgentLauncher: false,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Connect your computer");
    expect(wrapper.text()).toContain("npx @or3/connect");
    expect(wrapper.text()).toContain("Copy Connect command");
    expect(wrapper.text()).toContain("Advanced: connect by URL and token");
  });

  it("explains runner authentication and offers discovery refresh", async () => {
    mocks.snapshot.value = snapshot({
      connectionState: "degraded",
      runners: [
        {
          ...snapshot().runners[0]!,
          auth_status: "unknown",
        },
      ],
      sessions: [],
    });
    const wrapper = mount(ExternalAgentLauncher, {
      global: {
        ...global,
        stubs: {
          ...global.stubs,
          ExternalAgentLauncher: false,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("Sign in to Codex");
    expect(wrapper.text()).toContain("sign-in could not be verified");
    expect(wrapper.text()).toContain("Refresh agents");
  });

  it("preserves every advanced launcher choice across equivalent snapshots", async () => {
    const runner = {
      ...snapshot().runners[0]!,
      supports: {
        chat: {
          chatSelectable: true,
          chatReplay: true,
          customCwd: true,
        },
        dangerousBypassFlag: true,
      },
      models: [
        {
          id: "gpt-default",
          display_name: "GPT Default",
          default: true,
          reasoning: ["low", "high"],
          reasoning_default: "low",
        },
      ],
    };
    mocks.snapshot.value = snapshot({ runners: [runner], sessions: [] });
    const wrapper = mount(ExternalAgentLauncher, {
      global: {
        ...global,
        stubs: {
          ...global.stubs,
          ExternalAgentLauncher: false,
        },
      },
    });
    await flushPromises();

    await wrapper
      .find('select[aria-label="External agent mode"]')
      .setValue("sandbox_auto");
    await flushPromises();
    await wrapper
      .find('select[aria-label="External agent isolation"]')
      .setValue("sandbox_dangerous");
    await wrapper
      .find('[aria-label="External agent workspace root"]')
      .setValue("/workspace/custom");
    await wrapper
      .find('select[aria-label="External agent model"]')
      .setValue("gpt-default");
    await wrapper
      .find('select[aria-label="External agent reasoning level"]')
      .setValue("high");
    await wrapper.find('input[type="checkbox"]').setValue(true);
    await flushPromises();

    mocks.snapshot.value = snapshot({
      runners: [{ ...runner }],
      sessions: [{ ...session }],
      generation: 2,
    });
    await flushPromises();

    expect(
      (wrapper.find('select[aria-label="External agent mode"]')
        .element as HTMLSelectElement).value,
    ).toBe("sandbox_auto");
    expect(
      (wrapper.find('select[aria-label="External agent isolation"]')
        .element as HTMLSelectElement).value,
    ).toBe("sandbox_dangerous");
    expect(
      (wrapper.find('[aria-label="External agent workspace root"]')
        .element as HTMLInputElement).value,
    ).toBe("/workspace/custom");
    expect(
      (wrapper.find('select[aria-label="External agent model"]')
        .element as HTMLSelectElement).value,
    ).toBe("gpt-default");
    expect(
      (wrapper.find('select[aria-label="External agent reasoning level"]')
        .element as HTMLSelectElement).value,
    ).toBe("high");
    expect(
      (wrapper.find('input[type="checkbox"]').element as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("preserves text and attachments added while a launch is pending", async () => {
    const pendingLaunch = deferred<ExternalAgentSession>();
    mocks.controller.launch.mockReturnValueOnce(pendingLaunch.promise);
    const wrapper = mount(ExternalAgentLauncher, {
      global: {
        ...global,
        stubs: {
          ...global.stubs,
          ExternalAgentLauncher: false,
        },
      },
    });
    await flushPromises();

    const firstFile = new File(["first"], "first.ts", {
      type: "text/typescript",
    });
    const secondFile = new File(["second"], "second.ts", {
      type: "text/typescript",
    });
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [firstFile],
    });
    await input.trigger("change");
    await wrapper.find("textarea").setValue("Review the first draft");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    await wrapper.find("textarea").setValue("This is my next request");
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [secondFile],
    });
    await input.trigger("change");
    pendingLaunch.resolve(session);
    await flushPromises();

    expect(wrapper.find("textarea").element.value).toBe(
      "This is my next request",
    );
    expect(wrapper.text()).toContain("first.ts");
    expect(wrapper.text()).toContain("second.ts");
  });

  it("preserves a newer launch draft when the request fails", async () => {
    const pendingLaunch = deferred<ExternalAgentSession>();
    mocks.controller.launch.mockReturnValueOnce(pendingLaunch.promise);
    const wrapper = mount(ExternalAgentLauncher, {
      global: {
        ...global,
        stubs: {
          ...global.stubs,
          ExternalAgentLauncher: false,
        },
      },
    });
    await flushPromises();

    const textarea = wrapper.find("textarea");
    await textarea.setValue("Review the failing draft");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    await textarea.setValue("Keep this newer launch draft");

    pendingLaunch.reject(new Error("Host unavailable"));
    await flushPromises();

    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      "Keep this newer launch draft",
    );
    expect(wrapper.text()).toContain("Host unavailable");
  });

  it("preserves text and attachments added while a follow-up is pending", async () => {
    const completedSession: ExternalAgentSession = {
      ...session,
      status: "succeeded",
      activeTurnId: undefined,
      approvals: [],
      error: undefined,
      turns: [
        {
          id: "turn-1",
          session_id: "session-1",
          sequence: 1,
          status: "succeeded",
          continuation_mode: "replay",
          requested_at: Date.now() - 1_000,
          completed_at: Date.now(),
          user_message: "Initial request",
          final_text: "Done",
        },
      ],
    };
    mocks.snapshot.value = snapshot({ sessions: [completedSession] });
    const pendingFollowUp = deferred<void>();
    mocks.controller.followUp.mockReturnValueOnce(pendingFollowUp.promise);
    const wrapper = mount(ExternalAgentSessionPane, {
      props: {
        paneId: "pane-1",
        recordId: encodeExternalAgentSessionRef({
          hostId: "host-1",
          remoteSessionId: "session-1",
        }),
      },
      global,
    });
    await flushPromises();

    const firstFile = new File(["first"], "first.md", {
      type: "text/markdown",
    });
    const secondFile = new File(["second"], "second.md", {
      type: "text/markdown",
    });
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [firstFile],
    });
    await input.trigger("change");
    const textarea = wrapper.find(
      'textarea[aria-label="Message the agent"]',
    );
    await textarea.setValue("Review the first follow-up");
    await wrapper
      .find('form[aria-label="Agent composer"]')
      .trigger("submit");
    await flushPromises();

    await textarea.setValue("This is my next follow-up");
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [secondFile],
    });
    await input.trigger("change");
    pendingFollowUp.resolve();
    await flushPromises();

    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      "This is my next follow-up",
    );
    expect(wrapper.text()).toContain("first.md");
    expect(wrapper.text()).toContain("second.md");
  });

  it("preserves a newer follow-up draft when the request fails", async () => {
    const completedSession: ExternalAgentSession = {
      ...session,
      status: "succeeded",
      activeTurnId: undefined,
      approvals: [],
      error: undefined,
      turns: [],
    };
    mocks.snapshot.value = snapshot({ sessions: [completedSession] });
    const pendingFollowUp = deferred<void>();
    mocks.controller.followUp.mockReturnValueOnce(pendingFollowUp.promise);
    const errorHandler = vi.fn();
    const wrapper = mount(ExternalAgentSessionPane, {
      props: {
        paneId: "pane-1",
        recordId: encodeExternalAgentSessionRef({
          hostId: "host-1",
          remoteSessionId: "session-1",
        }),
      },
      global: {
        ...global,
        config: { errorHandler },
      },
    });
    await flushPromises();

    const textarea = wrapper.find(
      'textarea[aria-label="Message the agent"]',
    );
    await textarea.setValue("Review the failing follow-up");
    await wrapper
      .find('form[aria-label="Agent composer"]')
      .trigger("submit");
    await flushPromises();
    await textarea.setValue("Keep this newer follow-up draft");

    pendingFollowUp.reject(new Error("Host unavailable"));
    await flushPromises();

    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      "Keep this newer follow-up draft",
    );
    expect(errorHandler).toHaveBeenCalledOnce();
  });

  it("previews a selected file and sends it through the external-agent controller", async () => {
    const wrapper = mount(ExternalAgentLauncher, {
      global: {
        ...global,
        stubs: {
          ...global.stubs,
          ExternalAgentLauncher: false,
        },
      },
    });
    await flushPromises();
    const file = new File(["export default 42"], "answer.ts", {
      type: "text/typescript",
    });
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [file],
    });
    await input.trigger("change");
    await wrapper.find("textarea").setValue("Review this file");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).not.toContain("answer.ts");
    expect(mocks.controller.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: "Review this file",
        attachments: [
          expect.objectContaining({
            kind: "text",
            name: "answer.ts",
            mimeType: "text/typescript",
            sizeBytes: file.size,
            data: file,
          }),
        ],
      }),
    );
  });

  it("uses a non-empty sentinel for the host-default model option", () => {
    // Reka ComboboxItem rejects value="" (reserved for clearing selection).
    const source = readFileSync(
      resolve(
        process.cwd(),
        "app/components/external-agents/ExternalAgentSettingsPanel.vue",
      ),
      "utf8",
    );
    expect(source).toContain('HOST_DEFAULT_MODEL_VALUE = "host_default"');
    expect(source).toContain(
      '{ value: HOST_DEFAULT_MODEL_VALUE, label: "Recommended (default)" }',
    );
    expect(source).not.toContain('{ value: "", label: "Host default" }');
  });

  it("keeps the full settings panel reachable in short or zoomed viewports", async () => {
    const wrapper = mount(ExternalAgentLauncher, {
      global: {
        ...global,
        stubs: {
          ...global.stubs,
          ExternalAgentLauncher: false,
        },
      },
    });
    await flushPromises();

    const region = wrapper.find(
      '[data-testid="external-agent-settings-scroll-region"]',
    );
    expect(region.classes()).toContain(
      "max-h-[min(42rem,calc(100dvh-2rem))]",
    );
    expect(region.classes()).toContain("overflow-y-auto");
    expect(region.classes()).toContain("overscroll-contain");
  });

  it("submits the runner's authoritative model id without inventing a provider prefix", async () => {
    mocks.snapshot.value = snapshot({
      runners: [
        {
          id: "codex",
          display_name: "Codex",
          status: "available",
          auth_status: "ready",
          supports: {
            chat: { chatSelectable: true, chatReplay: true },
          },
          models: [
            {
              id: "gpt-5.6-luna",
              display_name: "GPT-5.6 Luna",
              provider: "openai",
              provider_name: "OpenAI Codex",
              reasoning: ["low", "medium", "high"],
              reasoning_default: "medium",
            },
          ],
          workspace_roots: ["/workspace"],
          default_cwd: "/workspace",
        },
      ],
    });
    mocks.controller.launch.mockResolvedValue(session);

    const wrapper = mount(ExternalAgentLauncher, {
      global: {
        ...global,
        stubs: {
          ...global.stubs,
          ExternalAgentLauncher: false,
        },
      },
    });
    await flushPromises();

    const modelSelect = wrapper.find(
      'select[aria-label="External agent model"]',
    );
    expect(modelSelect.text()).toContain("GPT-5.6 Luna · OpenAI Codex");
    await modelSelect.setValue("gpt-5.6-luna");
    const reasoningSelect = wrapper.find(
      'select[aria-label="External agent reasoning level"]',
    );
    expect(reasoningSelect.exists()).toBe(true);
    expect(reasoningSelect.text()).toContain("Model default (Medium)");
    await reasoningSelect.setValue("high");
    await wrapper.find("textarea").setValue("Say hello");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mocks.controller.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerId: "codex",
        model: "gpt-5.6-luna",
        thinkingLevel: "high",
      }),
    );
  });

  it("binds nondefault reasoning to the advertised default model", async () => {
    mocks.snapshot.value = snapshot({
      runners: [
        {
          ...snapshot().runners[0]!,
          models: [
            {
              id: "gpt-default",
              display_name: "GPT Default",
              default: true,
              reasoning: ["low", "high"],
              reasoning_default: "low",
            },
          ],
        },
      ],
    });
    const wrapper = mount(ExternalAgentLauncher, {
      global: {
        ...global,
        stubs: {
          ...global.stubs,
          ExternalAgentLauncher: false,
        },
      },
    });
    await flushPromises();

    expect(
      (wrapper.find('select[aria-label="External agent model"]')
        .element as HTMLSelectElement).value,
    ).toBe("host_default");
    await wrapper
      .find('select[aria-label="External agent reasoning level"]')
      .setValue("high");
    await wrapper.find("textarea").setValue("Investigate");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mocks.controller.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-default",
        thinkingLevel: "high",
      }),
    );
  });
});
