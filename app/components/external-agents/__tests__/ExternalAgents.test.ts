import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineComponent, h, shallowRef } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExternalAgentsSidebarPage from "../ExternalAgentsSidebarPage.vue";
import ExternalAgentSessionPane from "../ExternalAgentSessionPane.vue";
import ExternalAgentLauncher from "../ExternalAgentLauncher.vue";
import { encodeExternalAgentSessionRef } from "~/core/external-agents/refs";
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
    lockCredentials: vi.fn(),
    clearActiveHostCredential: vi.fn(),
    switchHost: vi.fn(),
    disconnect: vi.fn(),
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
  newPaneForApp: vi.fn(),
  setPaneApp: vi.fn(),
}));

vi.mock("~/core/external-agents/runtime", () => ({
  useExternalAgentRuntime: () => ({
    controller: mocks.controller,
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
    mocks.controller.clearActiveHostCredential.mockResolvedValue(undefined);
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
    expect(wrapper.text()).toContain("Add a trusted host");
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

    expect(wrapper.text()).toContain("Conversation unavailable");

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
    expect(wrapper.text()).not.toContain("Conversation unavailable");
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
            { id: "gpt-5.6-sol", display_name: "GPT-5.6 Sol" },
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
    await wrapper.find("textarea").setValue("Say hello");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(mocks.controller.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerId: "codex",
        model: "gpt-5.6-luna",
      }),
    );
  });
});
