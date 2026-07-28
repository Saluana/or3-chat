import { z } from "zod";
import { WorkspaceProfileV1Schema } from "./schema";
import { resolveWorkspaceProfile } from "./resolver";
import type {
  ResolvedWorkspaceProfile,
  WorkspaceProfileDeploymentLimits,
  WorkspaceProfileInventory,
} from "./types";

const InventoryItemSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().optional(),
  })
  .strict();

const HydrationPayloadSchema = z
  .object({
    version: z.literal(1),
    profile: WorkspaceProfileV1Schema,
    inventory: z
      .object({
        navigation: z.array(InventoryItemSchema),
        dashboard: z.array(InventoryItemSchema),
        panes: z.array(InventoryItemSchema),
        commands: z.array(InventoryItemSchema),
      })
      .strict(),
    limits: z
      .object({
        maxDesktopPanes: z.number().int().min(1),
        mobilePolicy: z.literal("single-pane"),
      })
      .strict(),
  })
  .strict();

export type WorkspaceProfileHydrationPayload = z.infer<
  typeof HydrationPayloadSchema
>;

export function createWorkspaceProfileHydrationPayload(
  profile: unknown,
  inventory: WorkspaceProfileInventory,
  limits: WorkspaceProfileDeploymentLimits,
): WorkspaceProfileHydrationPayload {
  return HydrationPayloadSchema.parse({
    version: 1,
    profile: WorkspaceProfileV1Schema.parse(profile),
    inventory,
    limits,
  });
}

export function hydrateWorkspaceProfilePayload(
  payload: unknown,
): ResolvedWorkspaceProfile {
  const parsed = HydrationPayloadSchema.parse(payload);
  return resolveWorkspaceProfile(
    parsed.profile,
    parsed.inventory,
    parsed.limits,
  );
}
