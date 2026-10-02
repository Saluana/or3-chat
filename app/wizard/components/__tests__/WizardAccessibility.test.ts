import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import WizardStepGeneric from "../WizardStepGeneric.vue";
import WizardStepPreset from "../WizardStepPreset.vue";
import WizardStepReview from "../WizardStepReview.vue";
import { createDefaultAnswers } from "~~/shared/cloud/wizard/catalog";
import type {
  WizardAnswers,
  WizardStep,
} from "~~/shared/cloud/wizard/types";

const IconStub = defineComponent({
  setup() {
    return () => h("span");
  },
});

const FieldStub = defineComponent({
  setup() {
    return () => h("div");
  },
});

const ButtonStub = defineComponent({
  inheritAttrs: false,
  emits: ["click"],
  setup(_, { attrs, emit, slots }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          disabled: attrs.disabled as boolean,
          onClick: () => emit("click"),
        },
        slots.default?.(),
      );
  },
});

const presetStep = {
  id: "preset",
  title: "Choose how OR3 runs",
  fields: [
    {
      key: "wizardMode",
      type: "select",
      label: "Deployment mode",
      options: [
        { value: "personal-local", label: "Personal" },
        { value: "preset-local", label: "Team server" },
      ],
    },
  ],
} as WizardStep;

describe("wizard accessibility", () => {
  it("shows and copies the login after Save Settings without requiring deployment", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      const wrapper = mount(WizardStepReview, {
        props: {
          step: { id: "review", title: "Review", fields: [] } as unknown as WizardStep,
          answers: {
            ...createDefaultAnswers({ instanceDir: "/opt/or3" }),
            basicAuthBootstrapEmail: "admin@example.com",
            basicAuthBootstrapPassword: "ExamplePassword123",
          },
          deployResponse: {
            ok: true,
            validation: { ok: true, errors: [], warnings: [], issues: [], derived: { env: {}, convexEnv: {}, providerModules: [] } },
            applyResult: { dryRun: false, writtenFiles: ["/opt/or3/.env"], backupFiles: [], envUpdates: {}, providerModules: [] },
          },
        },
        global: { stubs: { UButton: ButtonStub } },
      });
      expect(wrapper.text()).toContain("Save your admin login now");
      expect(wrapper.text()).toContain("admin@example.com");
      expect(wrapper.text()).toContain("ExamplePassword123");
      await wrapper.get('button[label="Copy login"]').trigger("click");
      expect(writeText).toHaveBeenCalledWith("OR3 admin login\nEmail: admin@example.com\nPassword: ExamplePassword123");
      await wrapper.setProps({ deployResponse: { ...wrapper.props("deployResponse")!, applyResult: { ...wrapper.props("deployResponse")!.applyResult!, dryRun: true } } });
      expect(wrapper.text()).not.toContain("Save your admin login now");
      wrapper.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses a native named radio group with a visible selected indicator", async () => {
    const wrapper = mount(WizardStepPreset, {
      props: {
        step: presetStep,
        answers: { wizardMode: "personal-local" } as WizardAnswers,
        fieldErrors: {},
      },
      global: {
        stubs: {
          UIcon: IconStub,
          WizardFieldRenderer: FieldStub,
        },
      },
    });

    const radios = wrapper.findAll('input[type="radio"]');
    expect(radios).toHaveLength(2);
    expect(radios[0]?.attributes("name")).toBe("or3-cloud-wizard-mode");
    expect((radios[0]?.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).toContain("Selected");

    await radios[1]?.setValue(true);
    expect(wrapper.emitted("update-field")?.at(-1)).toEqual([
      "wizardMode",
      "preset-local",
    ]);
  });

  it("announces connection-test results and exposes pending work", () => {
    const wrapper = mount(WizardStepGeneric, {
      props: {
        step: {
          id: "provider",
          title: "Provider",
          fields: [],
        } as unknown as WizardStep,
        answers: {} as WizardAnswers,
        fieldErrors: {},
        canTestConnection: true,
        isTestingConnection: true,
        connectionResult: {
          success: false,
          message: "Connection failed",
        },
      },
      global: {
        stubs: {
          UButton: ButtonStub,
          WizardFieldRenderer: FieldStub,
        },
      },
    });

    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true);
    const status = wrapper.find('[role="status"]');
    expect(status.attributes("aria-live")).toBe("polite");
    expect(status.attributes("aria-atomic")).toBe("true");
    expect(status.text()).toContain("Connection failed");
  });
});
