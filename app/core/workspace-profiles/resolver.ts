import { STANDARD_OR3_PROFILE, STANDARD_OR3_PROFILE_ID } from "./builtins";
import { WorkspaceProfileV1Schema, type WorkspaceProfileV1 } from "./schema";
import type {
  ResolvedWorkspaceProfile,
  ResolvedWorkspaceProfileGroup,
  WorkspaceProfileDeploymentLimits,
  WorkspaceProfileDiagnostic,
  WorkspaceProfileDiagnosticCode,
  WorkspaceProfileInventory,
  WorkspaceProfileInventoryItem,
} from "./types";

export function resolveWorkspaceProfile(
  input: unknown,
  inventory: WorkspaceProfileInventory,
  limits: WorkspaceProfileDeploymentLimits,
  options: { missingProfileId?: string } = {},
): ResolvedWorkspaceProfile {
  const parsed = WorkspaceProfileV1Schema.safeParse(input);
  const diagnostics: WorkspaceProfileDiagnostic[] = [];
  let profile: WorkspaceProfileV1;
  let usedFallback = false;
  const sourceProfileId =
    options.missingProfileId ??
    (isRecord(input) && typeof input.id === "string"
      ? input.id
      : STANDARD_OR3_PROFILE_ID);

  if (!parsed.success) {
    profile = STANDARD_OR3_PROFILE;
    usedFallback = true;
    diagnostics.push({
      code: options.missingProfileId ? "missing-profile" : "invalid-profile",
      message: options.missingProfileId
        ? `Workspace profile "${options.missingProfileId}" is unavailable`
        : "Workspace profile is invalid",
      id: options.missingProfileId,
    });
    diagnostics.push({
      code: "fallback-standard",
      message: "Resolved Standard OR3 instead",
      id: STANDARD_OR3_PROFILE_ID,
    });
  } else {
    profile = parsed.data;
  }

  const navigation = resolveIds({
    available: inventory.navigation,
    order: profile.navigation?.order,
    hidden: profile.navigation?.hidden,
    diagnostics,
    unknownCode: "unknown-navigation",
    path: "navigation",
  });
  const dashboard = resolveIds({
    available: inventory.dashboard,
    order: profile.dashboard?.order,
    hidden: profile.dashboard?.hidden,
    diagnostics,
    unknownCode: "unknown-dashboard",
    path: "dashboard",
  });
  const commands = resolveIds({
    available: inventory.commands,
    order: profile.commands?.order,
    hidden: profile.commands?.hidden,
    diagnostics,
    unknownCode: "unknown-command",
    path: "commands",
  });

  const availableNavigation = new Set(navigation);
  const defaultPageId = resolveDefaultPage(
    profile.navigation?.defaultPageId,
    navigation,
    diagnostics,
    "navigation.defaultPageId",
  );
  const bottomNavigation = resolveSubset(
    profile.mobile?.bottomNavigation,
    navigation,
    availableNavigation,
    diagnostics,
    "unknown-navigation",
    "mobile.bottomNavigation",
  );
  const mobileDefaultPageId = resolveDefaultPage(
    profile.mobile?.defaultPageId ?? defaultPageId ?? undefined,
    bottomNavigation.length ? bottomNavigation : navigation,
    diagnostics,
    "mobile.defaultPageId",
  );

  const groups = resolveGroups(
    profile,
    navigation,
    availableNavigation,
    diagnostics,
  );
  const paneIds = new Set(inventory.panes.map((item) => item.id));
  const initialPanes = [];
  for (const [index, pane] of (
    profile.workspace?.initialPanes ?? []
  ).entries()) {
    if (!paneIds.has(pane.id)) {
      diagnostics.push({
        code: "unknown-pane",
        message: `Ignoring unavailable pane "${pane.id}"`,
        path: `workspace.initialPanes.${index}`,
        id: pane.id,
      });
      continue;
    }
    initialPanes.push({ ...pane });
  }
  if (!initialPanes.length && paneIds.has("chat")) {
    initialPanes.push({ id: "chat" });
  }

  const requestedPaneLimit =
    profile.workspace?.desktopPaneLimit ?? limits.maxDesktopPanes;
  const desktopPaneLimit = Math.max(
    1,
    Math.min(requestedPaneLimit, limits.maxDesktopPanes),
  );
  if (requestedPaneLimit > limits.maxDesktopPanes) {
    diagnostics.push({
      code: "pane-limit-clamped",
      message: `Pane limit ${requestedPaneLimit} was clamped to deployment limit ${limits.maxDesktopPanes}`,
      path: "workspace.desktopPaneLimit",
    });
  }

  const pinned = resolveSubset(
    profile.commands?.pinned,
    commands,
    new Set(commands),
    diagnostics,
    "unknown-command",
    "commands.pinned",
  );

  return deepFreeze({
    schemaVersion: 1,
    id: profile.id,
    label: profile.label,
    ...(profile.description ? { description: profile.description } : {}),
    sourceProfileId,
    usedFallback,
    navigation: {
      items: navigation,
      hidden: [...(profile.navigation?.hidden ?? [])],
      groups,
      defaultPageId,
    },
    dashboard: {
      items: dashboard,
      hidden: [...(profile.dashboard?.hidden ?? [])],
    },
    workspace: {
      initialPanes: initialPanes.slice(0, desktopPaneLimit),
      desktopPaneLimit,
      mobilePolicy: limits.mobilePolicy,
    },
    commands: {
      items: commands,
      pinned,
      hidden: [...(profile.commands?.hidden ?? [])],
    },
    mobile: {
      bottomNavigation: bottomNavigation.length ? bottomNavigation : navigation,
      defaultPageId: mobileDefaultPageId,
    },
    diagnostics,
  });
}

function resolveIds(options: {
  available: readonly WorkspaceProfileInventoryItem[];
  order?: readonly string[];
  hidden?: readonly string[];
  diagnostics: WorkspaceProfileDiagnostic[];
  unknownCode: WorkspaceProfileDiagnosticCode;
  path: string;
}): string[] {
  const availableIds = options.available.map((item) => item.id);
  const available = new Set(availableIds);
  const hidden = new Set<string>();
  for (const [index, id] of (options.hidden ?? []).entries()) {
    if (!available.has(id)) {
      pushUnknown(options, id, `${options.path}.hidden.${index}`);
      continue;
    }
    hidden.add(id);
  }

  const output: string[] = [];
  for (const [index, id] of (options.order ?? []).entries()) {
    if (!available.has(id)) {
      pushUnknown(options, id, `${options.path}.order.${index}`);
      continue;
    }
    if (!hidden.has(id) && !output.includes(id)) output.push(id);
  }
  for (const id of availableIds) {
    if (!hidden.has(id) && !output.includes(id)) output.push(id);
  }
  return output;
}

function pushUnknown(
  options: Pick<
    Parameters<typeof resolveIds>[0],
    "diagnostics" | "unknownCode"
  >,
  id: string,
  path: string,
): void {
  options.diagnostics.push({
    code: options.unknownCode,
    message: `Ignoring unavailable contribution "${id}"`,
    path,
    id,
  });
}

function resolveSubset(
  requested: readonly string[] | undefined,
  fallback: readonly string[],
  available: ReadonlySet<string>,
  diagnostics: WorkspaceProfileDiagnostic[],
  code: WorkspaceProfileDiagnosticCode,
  path: string,
): string[] {
  if (!requested) return [...fallback];
  const output: string[] = [];
  for (const [index, id] of requested.entries()) {
    if (!available.has(id)) {
      diagnostics.push({
        code,
        message: `Ignoring unavailable contribution "${id}"`,
        path: `${path}.${index}`,
        id,
      });
      continue;
    }
    if (!output.includes(id)) output.push(id);
  }
  return output;
}

function resolveDefaultPage(
  requested: string | undefined,
  available: readonly string[],
  diagnostics: WorkspaceProfileDiagnostic[],
  path: string,
): string | null {
  if (!available.length) return null;
  if (!requested) return available[0] ?? null;
  if (available.includes(requested)) return requested;
  diagnostics.push({
    code: "invalid-default-page",
    message: `Default page "${requested}" is unavailable`,
    path,
    id: requested,
  });
  return available[0] ?? null;
}

function resolveGroups(
  profile: WorkspaceProfileV1,
  navigation: readonly string[],
  available: ReadonlySet<string>,
  diagnostics: WorkspaceProfileDiagnostic[],
): ResolvedWorkspaceProfileGroup[] {
  if (!profile.navigation?.groups?.length) {
    return [{ id: "default", label: "Navigation", items: [...navigation] }];
  }
  const claimed = new Set<string>();
  const groups = profile.navigation.groups.map((group, groupIndex) => {
    const items = resolveSubset(
      group.items,
      [],
      available,
      diagnostics,
      "unknown-navigation",
      `navigation.groups.${groupIndex}.items`,
    );
    items.forEach((id) => claimed.add(id));
    return { id: group.id, label: group.label, items };
  });
  const remaining = navigation.filter((id) => !claimed.has(id));
  if (remaining.length) {
    groups.push({
      id: "other",
      label: "Other",
      items: remaining,
    });
  }
  return groups;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
