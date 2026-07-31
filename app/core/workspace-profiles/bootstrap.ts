import { z } from "zod";
import { BUILTIN_WORKSPACE_PROFILES, STANDARD_OR3_PROFILE } from "./builtins";
import {
  WorkspaceProfileIdSchema,
  WorkspaceProfileV1Schema,
  type WorkspaceProfileV1,
} from "./schema";

export const WORKSPACE_PROFILE_SELECTION_COOKIE = "or3_workspace_profile_v1";

const LOCAL_WORKSPACE_SCOPE = "local";
const WorkspaceProfileSelectionCookieSchema = z
  .object({
    version: z.literal(1),
    workspaceId: z.string().trim().min(1).max(512),
    profileId: WorkspaceProfileIdSchema,
  })
  .strict();

export interface WorkspaceProfileBootstrapInput {
  readonly cookieHeader?: string;
  readonly workspaceId?: string | null;
  readonly additionalProfiles?: readonly unknown[];
}

export function workspaceProfileCookieScope(
  workspaceId: string | null | undefined,
): string {
  const normalized = workspaceId?.trim();
  return normalized || LOCAL_WORKSPACE_SCOPE;
}

export function serializeWorkspaceProfileSelectionCookie(
  workspaceId: string | null | undefined,
  profileId: string,
): string {
  return JSON.stringify(
    WorkspaceProfileSelectionCookieSchema.parse({
      version: 1,
      workspaceId: workspaceProfileCookieScope(workspaceId),
      profileId,
    }),
  );
}

export function readWorkspaceProfileSelectionCookie(
  cookieHeader: string | undefined,
  workspaceId: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;
  const encoded = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${WORKSPACE_PROFILE_SELECTION_COOKIE}=`))
    ?.slice(WORKSPACE_PROFILE_SELECTION_COOKIE.length + 1);
  if (!encoded) return null;

  try {
    const parsed = WorkspaceProfileSelectionCookieSchema.parse(
      JSON.parse(decodeURIComponent(encoded)),
    );
    return parsed.workspaceId === workspaceProfileCookieScope(workspaceId)
      ? parsed.profileId
      : null;
  } catch {
    return null;
  }
}

/**
 * Select the exact declarative profile used for SSR. Cookie input is only an
 * identifier; the returned definition must still come from trusted built-in
 * or validated installed-theme inventory.
 */
export function selectWorkspaceProfileForBootstrap(
  input: WorkspaceProfileBootstrapInput,
): WorkspaceProfileV1 {
  const selectedId = readWorkspaceProfileSelectionCookie(
    input.cookieHeader,
    input.workspaceId,
  );
  if (!selectedId) return STANDARD_OR3_PROFILE;

  const available = [
    ...BUILTIN_WORKSPACE_PROFILES,
    ...(input.additionalProfiles ?? []).flatMap((candidate) => {
      const parsed = WorkspaceProfileV1Schema.safeParse(candidate);
      return parsed.success ? [parsed.data] : [];
    }),
  ];
  return (
    available.find((profile) => profile.id === selectedId) ??
    STANDARD_OR3_PROFILE
  );
}

export function writeWorkspaceProfileSelectionCookie(
  workspaceId: string | null | undefined,
  profileId: string,
): void {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(
    serializeWorkspaceProfileSelectionCookie(workspaceId, profileId),
  );
  const secure =
    typeof location !== "undefined" && location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie =
    `${WORKSPACE_PROFILE_SELECTION_COOKIE}=${value}; ` +
    `Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
}
