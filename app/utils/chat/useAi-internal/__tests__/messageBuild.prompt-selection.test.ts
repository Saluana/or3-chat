import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROMPT_SELECTION,
  DISABLED_PROMPT_SELECTION,
} from "~/utils/chat/prompt-utils";
import {
  buildSystemPromptMessage,
  resolveSystemPromptText,
} from "../messageBuild";

const selection = vi.hoisted(() => ({
  thread: null as string | null,
  defaultId: null as string | null,
  getPrompt: vi.fn(),
}));

vi.mock("~/db/threads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/db/threads")>()),
  getThreadSystemPrompt: vi.fn(async () => selection.thread),
}));
vi.mock("~/db/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/db/prompts")>()),
  getPrompt: (...args: unknown[]) => selection.getPrompt(...args),
}));
vi.mock("~/composables/chat/useDefaultPrompt", () => ({
  getDefaultPromptId: vi.fn(async () => selection.defaultId),
}));

describe("thread system prompt selection", () => {
  beforeEach(() => {
    selection.thread = null;
    selection.defaultId = null;
    selection.getPrompt.mockReset();
    selection.getPrompt.mockImplementation(async (id: string) => ({
      id,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: id }] }],
      },
    }));
  });

  it("resolves Default using the current default prompt", async () => {
    selection.thread = DEFAULT_PROMPT_SELECTION;
    selection.defaultId = "default-prompt";
    expect(
      await resolveSystemPromptText({
        threadId: "chat-1",
        activePromptContent: null,
      }),
    ).toBe("default-prompt");
  });

  it("treats older chats without a selection as Default", async () => {
    selection.defaultId = "default-prompt";
    expect(
      await resolveSystemPromptText({
        threadId: "chat-1",
        activePromptContent: null,
      }),
    ).toBe("default-prompt");
  });

  it("suppresses saved prompts when Disabled is selected", async () => {
    selection.thread = DISABLED_PROMPT_SELECTION;
    selection.defaultId = "default-prompt";
    expect(
      await resolveSystemPromptText({
        threadId: "chat-1",
        activePromptContent: null,
      }),
    ).toBeNull();
    expect(selection.getPrompt).not.toHaveBeenCalled();
    expect(
      await buildSystemPromptMessage({
        threadId: "chat-1",
        activePromptContent: null,
        masterPrompt: "Global instruction",
      }),
    ).toBeNull();
  });

  it("keeps a specifically selected prompt independent of the default", async () => {
    selection.thread = "selected-prompt";
    selection.defaultId = "default-prompt";
    expect(
      await resolveSystemPromptText({
        threadId: "chat-1",
        activePromptContent: null,
      }),
    ).toBe("selected-prompt");
  });
});
