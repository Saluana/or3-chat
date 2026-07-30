import { describe, expect, it } from "vitest";
import {
  buildExternalAgentRunnerOption,
  resolveEffectiveExternalAgentModel,
  resolveExternalAgentModelReasoning,
  runnerUsability,
  validateExternalAgentLaunch,
} from "../launcher";
import type { ExternalAgentRunner } from "../types";

function runner(
  overrides: Partial<ExternalAgentRunner> = {},
): ExternalAgentRunner {
  return {
    id: "codex",
    display_name: "Codex",
    status: "available",
    auth_status: "ready",
    supports: {
      chat: { chatSelectable: true },
      safeSandboxFlag: true,
    },
    ...overrides,
  };
}

describe("external agent launcher policy", () => {
  it("uses conservative defaults and accepts only advertised roots", () => {
    const option = buildExternalAgentRunnerOption(
      runner({
        default_mode: "sandbox_auto",
        default_isolation: "sandbox_dangerous",
        workspace_roots: ["/workspace"],
      }),
    );

    expect(option.defaultMode).toBe("review");
    expect(option.defaultIsolation).toBe("host_readonly");
    expect(option.modes.map((item) => item.id)).not.toContain("sandbox_auto");
    expect(
      validateExternalAgentLaunch([option.runner], {
        runnerId: "codex",
        instruction: "Review the change",
        cwd: "/outside",
        mode: "review",
        isolation: "host_readonly",
      }),
    ).toMatchObject({ ok: false, code: "root_unavailable" });
  });

  it("shows but requires confirmation for an advertised dangerous mode", () => {
    const candidate = runner({
      supports: {
        chat: { chatSelectable: true },
        dangerousBypassFlag: true,
      },
    });
    const option = buildExternalAgentRunnerOption(candidate);

    expect(option.modes).toContainEqual(
      expect.objectContaining({
        id: "sandbox_auto",
        dangerous: true,
      }),
    );
    expect(
      validateExternalAgentLaunch([candidate], {
        runnerId: "codex",
        instruction: "Run autonomously",
        mode: "sandbox_auto",
        isolation: "sandbox_dangerous",
      }),
    ).toMatchObject({
      ok: false,
      code: "dangerous_confirmation_required",
    });
    expect(
      validateExternalAgentLaunch([candidate], {
        runnerId: "codex",
        instruction: "Run autonomously",
        mode: "sandbox_auto",
        isolation: "sandbox_dangerous",
        confirmDangerous: true,
      }),
    ).toMatchObject({ ok: true });
  });

  it("keeps unknown, unauthenticated and unselectable providers unavailable", () => {
    expect(
      validateExternalAgentLaunch([], {
        runnerId: "future-provider",
        instruction: "Work",
        mode: "review",
        isolation: "host_readonly",
      }),
    ).toMatchObject({ ok: false, code: "runner_unavailable" });

    expect(
      buildExternalAgentRunnerOption(runner({ auth_status: "unknown" })),
    ).toMatchObject({ available: false });
    expect(
      buildExternalAgentRunnerOption(
        runner({
          chat_capabilities: { chatSelectable: false },
        }),
      ),
    ).toMatchObject({ available: false });
    expect(
      buildExternalAgentRunnerOption(runner({ supports: {} })),
    ).toMatchObject({ available: false });
  });

  it.each([
    ["available", "ready", true, "ready"],
    ["available", "unknown", false, "authentication_required"],
    ["available", "signed_out", false, "authentication_required"],
    ["not_installed", "ready", false, "provider_unavailable"],
    ["unavailable", "ready", false, "provider_unavailable"],
  ] as const)(
    "uses one usability result for status=%s auth=%s",
    (status, authStatus, usable, code) => {
      const candidate = runner({ status, auth_status: authStatus });
      expect(runnerUsability(candidate)).toMatchObject({ usable, code });
      expect(buildExternalAgentRunnerOption(candidate).available).toBe(usable);
    },
  );

  it("rejects policy combinations that the host would reject", () => {
    expect(
      validateExternalAgentLaunch([runner()], {
        runnerId: "codex",
        instruction: "Edit",
        mode: "review",
        isolation: "host_workspace_write",
      }),
    ).toMatchObject({
      ok: false,
      code: "capability_unavailable",
    });
  });

  it("allows custom working directories only when explicitly advertised", () => {
    const restricted = runner({
      workspace_roots: ["/", "C:\\Workspace"],
    });
    expect(
      validateExternalAgentLaunch([restricted], {
        runnerId: "codex",
        instruction: "Review",
        cwd: "/project/src",
        mode: "review",
        isolation: "host_readonly",
      }),
    ).toMatchObject({ ok: false, code: "root_unavailable" });

    const candidate = runner({
      chat_capabilities: {
        chatSelectable: true,
        customCwd: true,
      },
      workspace_roots: ["/", "C:\\Workspace"],
    });

    expect(
      validateExternalAgentLaunch([candidate], {
        runnerId: "codex",
        instruction: "Review",
        cwd: "/project/src",
        mode: "review",
        isolation: "host_readonly",
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateExternalAgentLaunch([candidate], {
        runnerId: "codex",
        instruction: "Review",
        cwd: "c:\\workspace\\src",
        mode: "review",
        isolation: "host_readonly",
      }),
    ).toMatchObject({ ok: true });
  });

  it("resolves reasoning levels from model capabilities and option descriptors", () => {
    expect(
      resolveExternalAgentModelReasoning(
        runner({
          models: [
            {
              id: "gpt-5.6-sol",
              default: true,
              reasoning: ["low", "medium", "high", "xhigh"],
              reasoning_default: "medium",
            },
          ],
        }),
        null,
      ),
    ).toEqual({
      values: ["low", "medium", "high", "xhigh"],
      defaultValue: "medium",
    });

    expect(
      resolveExternalAgentModelReasoning(
        runner({
          id: "opencode",
          models: [
            {
              id: "kimi-k2.5",
              options: [
                {
                  id: "thinking",
                  type: "select",
                  values: [{ value: "low" }, { value: "high" }],
                  default_value: "high",
                },
              ],
            },
          ],
        }),
        "kimi-k2.5",
      ),
    ).toEqual({
      values: ["low", "high"],
      defaultValue: "high",
    });
  });

  it("rejects reasoning levels the selected model does not advertise", () => {
    const candidate = runner({
      models: [
        {
          id: "gpt-5.6-sol",
          reasoning: ["low", "medium", "high"],
        },
      ],
    });

    expect(
      validateExternalAgentLaunch([candidate], {
        runnerId: "codex",
        instruction: "Review",
        mode: "review",
        isolation: "host_readonly",
        model: "gpt-5.6-sol",
        thinkingLevel: "xhigh",
      }),
    ).toMatchObject({
      ok: false,
      code: "capability_unavailable",
    });
    expect(
      validateExternalAgentLaunch([candidate], {
        runnerId: "codex",
        instruction: "Review",
        mode: "review",
        isolation: "host_readonly",
        model: "gpt-5.6-sol",
        thinkingLevel: "high",
      }),
    ).toMatchObject({ ok: true });
  });

  it.each([
    {
      name: "Codex",
      id: "codex",
      model: {
        id: "gpt-5.6-sol",
        default: true,
        reasoning: ["low", "high"],
      },
    },
    {
      name: "OpenCode",
      id: "opencode",
      model: {
        id: "kimi-k2.5",
        default: true,
        options: [
          {
            id: "thinking",
            type: "select",
            values: [{ value: "low" }, { value: "high" }],
          },
        ],
      },
    },
  ])(
    "binds $name reasoning to the advertised default model",
    ({ id, model }) => {
      const candidate = runner({
        id,
        display_name: id,
        models: [model],
      });
      expect(
        resolveEffectiveExternalAgentModel(candidate, null, "high"),
      ).toBe(model.id);
      expect(
        validateExternalAgentLaunch([candidate], {
          runnerId: id,
          instruction: "Review",
          mode: "review",
          isolation: "host_readonly",
          thinkingLevel: "high",
        }),
      ).toMatchObject({
        ok: true,
        input: {
          model: model.id,
          thinkingLevel: "high",
        },
      });
    },
  );
});
