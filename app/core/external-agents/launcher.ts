import type { ExternalAgentLaunchInput, ExternalAgentRunner } from "./types";

export interface ExternalAgentLaunchOption {
  readonly id: string;
  readonly label: string;
  readonly dangerous: boolean;
}

export interface ExternalAgentRunnerOption {
  readonly runner: ExternalAgentRunner;
  readonly available: boolean;
  readonly unavailableReason?: string;
  readonly modes: readonly ExternalAgentLaunchOption[];
  readonly isolations: readonly ExternalAgentLaunchOption[];
  readonly roots: readonly string[];
  readonly customCwd: boolean;
  readonly defaultMode: string;
  readonly defaultIsolation: string;
  readonly defaultCwd: string;
}

export type ExternalAgentLaunchValidation =
  | {
      readonly ok: true;
      readonly runner: ExternalAgentRunnerOption;
      readonly input: ExternalAgentLaunchInput;
    }
  | {
      readonly ok: false;
      readonly code:
        | "runner_unavailable"
        | "invalid_instruction"
        | "capability_unavailable"
        | "root_unavailable"
        | "dangerous_confirmation_required";
      readonly message: string;
    };

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function booleanField(
  value: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  return value[key] === true;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function advertisedRoots(runner: ExternalAgentRunner): string[] {
  const runtime = record(runner.runtime);
  const roots = [
    ...stringArray(runner.workspace_roots),
    ...stringArray(runner.roots),
    ...stringArray(runtime.workspace_roots),
    ...stringArray(runtime.roots),
  ];
  return [...new Set(roots)];
}

export function buildExternalAgentRunnerOption(
  runner: ExternalAgentRunner,
): ExternalAgentRunnerOption {
  const supports = record(runner.supports);
  const chat = record(runner.chat_capabilities ?? supports.chat);
  const selectable = chat.chatSelectable === true;
  const available =
    runner.status === "available" &&
    runner.auth_status === "ready" &&
    selectable;
  const modes: ExternalAgentLaunchOption[] = [
    { id: "review", label: "Review only", dangerous: false },
    { id: "safe_edit", label: "Safe edit", dangerous: false },
  ];
  const isolations: ExternalAgentLaunchOption[] = [
    { id: "host_readonly", label: "Read only", dangerous: false },
    {
      id: "host_workspace_write",
      label: "Workspace write",
      dangerous: false,
    },
  ];
  if (booleanField(supports, "safeSandboxFlag")) {
    isolations.push({
      id: "sandbox_workspace_write",
      label: "Sandbox workspace write",
      dangerous: false,
    });
  }
  if (booleanField(supports, "dangerousBypassFlag")) {
    modes.push({
      id: "sandbox_auto",
      label: "Dangerous full access",
      dangerous: true,
    });
    isolations.push({
      id: "sandbox_dangerous",
      label: "Dangerous sandbox bypass",
      dangerous: true,
    });
  }

  const requestedDefaultMode = String(runner.default_mode ?? "").trim();
  const requestedDefaultIsolation = String(
    runner.default_isolation ?? "",
  ).trim();
  const defaultMode = modes.some(
    (item) => item.id === requestedDefaultMode && !item.dangerous,
  )
    ? requestedDefaultMode
    : "review";
  const safeIsolationForMode =
    defaultMode === "review" ? "host_readonly" : "host_workspace_write";
  const defaultIsolation = isolations.some(
    (item) =>
      item.id === requestedDefaultIsolation &&
      !item.dangerous &&
      validPolicyCombination(defaultMode, item.id),
  )
    ? requestedDefaultIsolation
    : safeIsolationForMode;

  return Object.freeze({
    runner,
    available,
    unavailableReason: available
      ? undefined
      : runner.status !== "available"
        ? `Provider is ${runner.status.replaceAll("_", " ")}`
        : runner.auth_status !== "ready"
          ? `Authentication is ${runner.auth_status.replaceAll("_", " ")}`
          : "Chat sessions are not advertised by this provider",
    modes: Object.freeze(modes),
    isolations: Object.freeze(isolations),
    roots: Object.freeze(advertisedRoots(runner)),
    customCwd: chat.customCwd === true,
    defaultMode,
    defaultIsolation,
    defaultCwd: String(runner.default_cwd ?? "").trim(),
  });
}

export function buildExternalAgentRunnerOptions(
  runners: readonly ExternalAgentRunner[],
): readonly ExternalAgentRunnerOption[] {
  return Object.freeze(
    runners
      .map(buildExternalAgentRunnerOption)
      .sort((left, right) =>
        left.runner.display_name.localeCompare(right.runner.display_name),
      ),
  );
}

function validPolicyCombination(mode: string, isolation: string): boolean {
  if (mode === "review") {
    return (
      isolation === "host_readonly" || isolation === "sandbox_workspace_write"
    );
  }
  if (mode === "safe_edit") {
    return (
      isolation === "host_workspace_write" ||
      isolation === "sandbox_workspace_write"
    );
  }
  return mode === "sandbox_auto" && isolation === "sandbox_dangerous";
}

function normalizedPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized === "/") return normalized;
  if (/^[a-z]:\/+$/i.test(normalized)) {
    return `${normalized.slice(0, 2)}/`;
  }
  return normalized.replace(/\/+$/, "");
}

export function validateExternalAgentLaunch(
  runners: readonly ExternalAgentRunner[],
  input: ExternalAgentLaunchInput,
): ExternalAgentLaunchValidation {
  const option = buildExternalAgentRunnerOptions(runners).find(
    (candidate) => candidate.runner.id === input.runnerId,
  );
  if (!option?.available) {
    return {
      ok: false,
      code: "runner_unavailable",
      message:
        option?.unavailableReason ??
        "The selected provider is unknown or unavailable",
    };
  }
  if (!input.instruction.trim()) {
    return {
      ok: false,
      code: "invalid_instruction",
      message: "Describe the work for the external agent",
    };
  }
  const mode = option.modes.find((item) => item.id === input.mode);
  const isolation = option.isolations.find(
    (item) => item.id === input.isolation,
  );
  if (!mode || !isolation || !validPolicyCombination(mode.id, isolation.id)) {
    return {
      ok: false,
      code: "capability_unavailable",
      message: "This provider did not advertise the selected safety policy",
    };
  }
  const cwd = input.cwd?.trim();
  const advertisedCwds = [
    ...option.roots,
    ...(option.defaultCwd ? [option.defaultCwd] : []),
  ];
  if (
    cwd &&
    !option.customCwd &&
    !advertisedCwds.some(
      (candidate) => normalizedPath(cwd) === normalizedPath(candidate),
    )
  ) {
    return {
      ok: false,
      code: "root_unavailable",
      message:
        "Choose the default working directory or a workspace root advertised by the host",
    };
  }
  if ((mode.dangerous || isolation.dangerous) && !input.confirmDangerous) {
    return {
      ok: false,
      code: "dangerous_confirmation_required",
      message: "Confirm dangerous full access before continuing",
    };
  }
  return { ok: true, runner: option, input };
}
