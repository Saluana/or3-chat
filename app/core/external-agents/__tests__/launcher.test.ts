import { describe, expect, it } from "vitest";
import {
  buildExternalAgentRunnerOption,
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
});
