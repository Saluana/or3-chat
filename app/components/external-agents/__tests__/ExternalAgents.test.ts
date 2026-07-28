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
    newPaneForApp: mocks.newPaneForApp,
    setPaneApp: mocks.setPaneApp,
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
    mocks.controller.launch.mockResolvedValue(session);
    mocks.controller.canCancel.mockReturnValue(true);
    mocks.controller.canDecideApproval.mockReturnValue(true);
    mocks.controller.canFollowUp.mockReturnValue(true);
    mocks.controller.canReadArtifact.mockReturnValue(true);
  });

  it("renders degraded connection plus running, approvals, failed and recent sections responsively", async () => {
    const wrapper = mount(ExternalAgentsSidebarPage, { global });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Add host")
      ?.trigger("click");

    expect(wrapper.text()).toContain("Capability discovery is incomplete");
    expect(wrapper.text()).toContain("pre-issued service access token");
    expect(wrapper.text()).toContain("Secure QR pairing is not supported");
    expect(wrapper.text()).toContain("Health: ok");
    expect(wrapper.text()).toContain("Readiness: unavailable");
    expect(wrapper.text()).toContain("Running");
    expect(wrapper.text()).toContain("Approvals");
    expect(wrapper.text()).toContain("Failed");
    expect(wrapper.text()).toContain("Recent");
    expect(wrapper.text()).toContain("Fix mobile layout");
    expect(wrapper.find("section").classes()).toContain("flex");
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

    expect(sidebar.text()).toContain("Host offline");
    expect(sidebar.text()).toContain("Host could not be reached");
    expect(pane.text()).toContain("Host disconnected");
    expect(pane.text()).toContain("Reconnect from the Agents sidebar");
  });

  it("renders timeline, files, approvals, errors and real actions in a mobile-safe pane", async () => {
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
    expect(wrapper.find("section").classes()).toContain("p-3");
    expect(wrapper.html()).toContain("sm:p-5");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Approve")
      ?.trigger("click");
    expect(mocks.controller.decideApproval).toHaveBeenCalledWith(
      "session-1",
      "approve",
      "approval-1",
    );

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Cancel")
      ?.trigger("click");
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
});
