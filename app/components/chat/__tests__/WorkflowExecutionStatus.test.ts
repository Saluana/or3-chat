import { beforeEach, describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import WorkflowExecutionStatus from "../WorkflowExecutionStatus.vue";
import type { UiWorkflowState } from "~/utils/chat/workflow-types";

// Mocks
vi.mock("~/composables/useIcon", () => ({
  useIcon: (name: string) => ({ value: `icon-${name}` }),
}));

vi.mock("#app", () => ({
  useNuxtApp: () => ({
    $theme: {
      current: { value: "light" },
      get: () => "light",
    },
  }),
}));

vi.mock("#imports", () => ({
  useToast: () => ({
    add: vi.fn(),
  }),
}));

// Mock streamdown-vue
vi.mock("streamdown-vue", () => ({
  StreamMarkdown: {
    template: '<div class="stream-markdown">{{ content }}</div>',
    props: ["content", "shikiTheme"],
  },
  useShikiHighlighter: vi.fn().mockResolvedValue(undefined),
}));

import { defineComponent } from "vue";

// Mock StreamMarkdown component
const StreamMarkdown = defineComponent({
  name: "StreamMarkdown",
  template: '<div class="stream-markdown">{{ content }}</div>',
  props: ["content", "shikiTheme"],
});

// Mock UIcon component
const UIcon = defineComponent({
  name: "UIcon",
  template: '<div class="u-icon" :data-name="name"></div>',
  props: ["name"],
});

describe("WorkflowExecutionStatus", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const mockState: UiWorkflowState = {
    workflowId: "wf-1",
    workflowName: "Test Workflow",
    executionState: "running",
    nodeStates: {
      "node-1": {
        status: "completed",
        label: "Node 1",
        type: "agent",
        output: "Output 1",
        streamingText: undefined,
        tokenCount: 10,
        startedAt: Date.now() - 2000,
        finishedAt: Date.now() - 1000,
      },
      "node-2": {
        status: "active",
        label: "Node 2",
        type: "tool",
        output: "",
        streamingText: "Streaming...",
        tokenCount: 5,
        startedAt: Date.now() - 900,
      },
    },
    executionOrder: ["node-1", "node-2"],
    currentNodeId: "node-2",
    branches: {},
  };

  it("renders header with correct status", () => {
    const wrapper = mount(WorkflowExecutionStatus, {
      props: { workflowState: mockState },
      global: {
        components: { StreamMarkdown, UIcon },
      },
    });

    expect(wrapper.text()).toContain("Test Workflow");
    expect(wrapper.text()).toContain("Running");
    expect(wrapper.text()).toContain("1 / 2 complete");

    const statusIcon = wrapper.find(
      '.u-icon[data-name="icon-workflow.status.running"]',
    );
    expect(statusIcon.exists()).toBe(true);
  });

  it("renders node list in execution order", async () => {
    const wrapper = mount(WorkflowExecutionStatus, {
      props: { workflowState: mockState },
      global: {
        components: { StreamMarkdown, UIcon },
      },
    });

    const nodes = wrapper.findAll(".node-item");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.text()).toContain("Node 1");
    expect(nodes[1]!.text()).toContain("Node 2");
  });

  it("keeps the split-pane controls for completed runs and long labels", () => {
    const longLabel =
      "A deliberately long completed workflow step name that must stay within the timeline pane";
    const completedState: UiWorkflowState = {
      ...mockState,
      executionState: "completed",
      nodeStates: {
        ...mockState.nodeStates,
        "node-2": {
          ...mockState.nodeStates["node-2"]!,
          status: "completed",
          label: longLabel,
          streamingText: undefined,
          output: "Finished output",
          finishedAt: Date.now(),
        },
      },
    };
    const wrapper = mount(WorkflowExecutionStatus, {
      props: { workflowState: completedState },
      global: {
        components: { StreamMarkdown, UIcon },
      },
    });

    expect(wrapper.find(".workflow-run").attributes("data-state")).toBe(
      "completed",
    );
    expect(wrapper.find(".timeline-label").exists()).toBe(true);
    expect(wrapper.text()).toContain(longLabel);
    expect(wrapper.find(".run-progress").exists()).toBe(false);
    expect(
      wrapper.find(".timeline-divider-toggle").attributes("aria-label"),
    ).toBe("Collapse run timeline");
    expect(wrapper.find(".run-inspector").exists()).toBe(true);
  });

  it("renders node output", async () => {
    const wrapper = mount(WorkflowExecutionStatus, {
      props: { workflowState: mockState },
      global: {
        components: { StreamMarkdown, UIcon },
      },
    });

    await wrapper.findAll(".timeline-row")[0]!.trigger("click");
    expect(wrapper.find(".run-inspector").text()).toContain("Output 1");
    await wrapper.findAll(".timeline-row")[1]!.trigger("click");
    expect(wrapper.text()).toContain("Streaming...");
  });

  it("toggles collapse state", async () => {
    const wrapper = mount(WorkflowExecutionStatus, {
      props: { workflowState: mockState },
      global: {
        components: { StreamMarkdown, UIcon },
      },
    });

    expect(wrapper.find(".node-item").exists()).toBe(true);
    expect(wrapper.find(".run-progress").exists()).toBe(true);

    await wrapper.find(".run-collapse-button").trigger("click");
    expect(wrapper.find(".node-item").exists()).toBe(false);
    expect(wrapper.find(".run-progress").exists()).toBe(false);

    await wrapper.find(".run-collapse-button").trigger("click");
    expect(wrapper.find(".node-item").exists()).toBe(true);
    expect(wrapper.find(".run-progress").exists()).toBe(true);
  });

  it("collapses the timeline without hiding the focused inspector", async () => {
    const wrapper = mount(WorkflowExecutionStatus, {
      props: { workflowState: mockState },
      global: {
        components: { StreamMarkdown, UIcon },
      },
    });

    expect(wrapper.find(".run-timeline").exists()).toBe(true);
    expect(wrapper.find(".run-inspector").exists()).toBe(true);

    await wrapper.find(".timeline-divider-toggle").trigger("click");
    expect(wrapper.find(".run-timeline").exists()).toBe(true);
    expect(wrapper.find(".run-inspector").exists()).toBe(true);
    expect(wrapper.find(".run-layout").classes()).toContain(
      "is-timeline-collapsed",
    );
    expect(
      wrapper.find(".timeline-divider-toggle").attributes("aria-label"),
    ).toBe("Expand run timeline");

    await wrapper.find(".timeline-divider-toggle").trigger("click");
    expect(wrapper.find(".run-timeline").exists()).toBe(true);
    expect(wrapper.find(".run-inspector").exists()).toBe(true);
    expect(
      wrapper.find(".timeline-divider-toggle").attributes("aria-label"),
    ).toBe("Collapse run timeline");
  });

  it("drills into a selected step and returns to the timeline on small panes", async () => {
    const wrapper = mount(WorkflowExecutionStatus, {
      props: { workflowState: mockState },
      global: {
        components: { StreamMarkdown, UIcon },
      },
    });

    expect(wrapper.find(".run-layout").classes()).not.toContain(
      "is-mobile-inspector",
    );

    await wrapper.findAll(".timeline-row")[0]!.trigger("click");
    expect(wrapper.find(".run-layout").classes()).toContain(
      "is-mobile-inspector",
    );
    expect(wrapper.find(".run-inspector").text()).toContain("Output 1");

    await wrapper.find(".mobile-timeline-back").trigger("click");
    expect(wrapper.find(".run-layout").classes()).not.toContain(
      "is-mobile-inspector",
    );
  });

  it("shows cancelled nodes distinctly and exposes resume in the header", async () => {
    const stoppedState: UiWorkflowState = {
      ...mockState,
      executionState: "stopped",
    };
    const wrapper = mount(WorkflowExecutionStatus, {
      props: { workflowState: stoppedState, canResume: true },
      global: {
        components: { StreamMarkdown, UIcon },
      },
    });

    expect(wrapper.find(".run-resume-button").exists()).toBe(true);
    expect(wrapper.find(".inspector-subtitle").text()).toContain("Cancelled");
    expect(
      wrapper
        .find(
          '.timeline-status-icon[data-name="icon-workflow.status.cancelled"]',
        )
        .exists(),
    ).toBe(true);

    await wrapper.find(".run-resume-button").trigger("click");
    expect(wrapper.emitted("resume")).toHaveLength(1);
  });

  it("renders parallel branches", async () => {
    const stateWithBranches: UiWorkflowState = {
      ...mockState,
      branches: {
        "node-2:branch-1": {
          id: "branch-1",
          label: "Branch 1",
          status: "active",
          output: "",
          streamingText: "Branch output",
        },
      },
    };

    const wrapper = mount(WorkflowExecutionStatus, {
      props: { workflowState: stateWithBranches },
      global: {
        components: { StreamMarkdown, UIcon },
      },
    });

    expect(wrapper.text()).toContain("Branch 1");
    expect(wrapper.text()).toContain("Branch output");
  });

  it("renders error state", async () => {
    const errorState: UiWorkflowState = {
      ...mockState,
      executionState: "error",
      nodeStates: {
        "node-1": {
          status: "error",
          label: "Node 1",
          type: "agent",
          output: "",
          error: "Something failed",
        },
      },
      executionOrder: ["node-1"],
    };

    const wrapper = mount(WorkflowExecutionStatus, {
      props: { workflowState: errorState },
      global: {
        components: { StreamMarkdown, UIcon },
      },
    });

    // Header is always visible
    expect(wrapper.text()).toContain("Error");
    const errorIcon = wrapper.find(
      '.u-icon[data-name="icon-workflow.status.error"]',
    );
    expect(errorIcon.exists()).toBe(true);

    await wrapper.find(".timeline-row").trigger("click");
    expect(wrapper.text()).toContain("Something failed");
  });

  it("uses plaintext while streaming and markdown when completed", async () => {
    const wrapper = mount(WorkflowExecutionStatus, {
      props: { workflowState: mockState },
      global: {
        components: { StreamMarkdown, UIcon },
      },
    });

    const rows = wrapper.findAll(".timeline-row");
    await rows[0]!.trigger("click");
    expect(wrapper.find(".run-inspector .stream-markdown").exists()).toBe(true);

    await rows[1]!.trigger("click");
    expect(wrapper.find(".run-inspector .streaming-plain").exists()).toBe(true);
    expect(
      wrapper.find(".run-inspector").findComponent(StreamMarkdown).exists(),
    ).toBe(false);
  });

  it("explains when an active model is still thinking", async () => {
    const state: UiWorkflowState = {
      ...mockState,
      nodeStates: {
        "node-1": {
          status: "active",
          label: "Planner",
          type: "agent",
          output: "",
          streamingText: "",
          activity: "thinking",
          reasoningText: "I should plan the response before writing.",
        },
      },
      executionOrder: ["node-1"],
    };
    const wrapper = mount(WorkflowExecutionStatus, {
      props: { workflowState: state },
      global: { components: { StreamMarkdown, UIcon } },
    });

    expect(wrapper.find(".reasoning-panel").text()).toContain(
      "I should plan the response before writing.",
    );
    expect(wrapper.text()).toContain("Receiving reasoning");
  });
});
