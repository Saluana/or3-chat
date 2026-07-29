import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ChatComposerShell from "../ChatComposerShell.vue";

describe("ChatComposerShell", () => {
  it("renders a compact composer by default", () => {
    const wrapper = mount(ChatComposerShell, {
      slots: { default: '<textarea aria-label="Prompt" />' },
    });

    expect(wrapper.element.tagName).toBe("DIV");
    expect(wrapper.classes()).toContain("chat-composer-shell");
    expect(wrapper.classes()).toContain("chat-composer-shell--sm");
    expect(wrapper.attributes("data-composer-size")).toBe("sm");
    expect(wrapper.get("textarea").attributes("aria-label")).toBe("Prompt");
  });

  it("supports the large form variant without losing native attributes", () => {
    const wrapper = mount(ChatComposerShell, {
      props: { tag: "form", size: "lg" },
      attrs: {
        id: "agent-composer",
        "aria-label": "Agent composer",
      },
    });

    expect(wrapper.element.tagName).toBe("FORM");
    expect(wrapper.classes()).toContain("chat-composer-shell--lg");
    expect(wrapper.attributes("id")).toBe("agent-composer");
    expect(wrapper.attributes("aria-label")).toBe("Agent composer");
  });
});
