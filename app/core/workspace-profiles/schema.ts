import { z } from "zod";

export const WorkspaceProfileIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[a-z0-9][a-z0-9._:-]*$/,
    "Profile and contribution ids must be lowercase and path-safe",
  );

const UniqueIdsSchema = z
  .array(WorkspaceProfileIdSchema)
  .max(200)
  .superRefine((ids, context) => {
    const seen = new Set<string>();
    for (const [index, id] of ids.entries()) {
      if (seen.has(id)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Duplicate id "${id}"`,
        });
      }
      seen.add(id);
    }
  });

export const WorkspaceProfileGroupSchema = z
  .object({
    id: WorkspaceProfileIdSchema,
    label: z.string().trim().min(1).max(80),
    items: UniqueIdsSchema,
  })
  .strict();

export const WorkspaceProfileInitialPaneSchema = z
  .object({
    id: WorkspaceProfileIdSchema,
    recordId: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

const WorkspaceProfileGroupsSchema = z
  .array(WorkspaceProfileGroupSchema)
  .max(50)
  .superRefine((groups, context) => {
    const groupIds = new Set<string>();
    const itemIds = new Set<string>();
    for (const [groupIndex, group] of groups.entries()) {
      if (groupIds.has(group.id)) {
        context.addIssue({
          code: "custom",
          path: [groupIndex, "id"],
          message: `Duplicate group id "${group.id}"`,
        });
      }
      groupIds.add(group.id);
      for (const [itemIndex, itemId] of group.items.entries()) {
        if (itemIds.has(itemId)) {
          context.addIssue({
            code: "custom",
            path: [groupIndex, "items", itemIndex],
            message: `Navigation item "${itemId}" belongs to more than one group`,
          });
        }
        itemIds.add(itemId);
      }
    }
  });

export const WorkspaceProfileV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: WorkspaceProfileIdSchema,
    label: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(500).optional(),
    navigation: z
      .object({
        defaultPageId: WorkspaceProfileIdSchema.optional(),
        groups: WorkspaceProfileGroupsSchema.optional(),
        order: UniqueIdsSchema.optional(),
        hidden: UniqueIdsSchema.optional(),
      })
      .strict()
      .optional(),
    dashboard: z
      .object({
        order: UniqueIdsSchema.optional(),
        hidden: UniqueIdsSchema.optional(),
      })
      .strict()
      .optional(),
    workspace: z
      .object({
        initialPanes: z
          .array(WorkspaceProfileInitialPaneSchema)
          .max(12)
          .optional(),
        desktopPaneLimit: z.number().int().min(1).max(12).optional(),
        mobilePolicy: z.literal("single-pane").optional(),
      })
      .strict()
      .optional(),
    commands: z
      .object({
        pinned: UniqueIdsSchema.optional(),
        order: UniqueIdsSchema.optional(),
        hidden: UniqueIdsSchema.optional(),
      })
      .strict()
      .optional(),
    mobile: z
      .object({
        bottomNavigation: UniqueIdsSchema.optional(),
        defaultPageId: WorkspaceProfileIdSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type WorkspaceProfileV1 = z.infer<typeof WorkspaceProfileV1Schema>;
export type WorkspaceProfileGroup = z.infer<typeof WorkspaceProfileGroupSchema>;
export type WorkspaceProfileInitialPane = z.infer<
  typeof WorkspaceProfileInitialPaneSchema
>;

export function parseWorkspaceProfile(input: unknown): WorkspaceProfileV1 {
  return WorkspaceProfileV1Schema.parse(input);
}
