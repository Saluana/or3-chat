import { z } from 'zod';

export const ExtensionKindSchema = z.enum(['plugin', 'theme', 'admin_plugin']);
export type ExtensionKind = z.infer<typeof ExtensionKindSchema>;

const ExtensionIdSchema = z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9._-]+$/, 'Invalid extension id')
    .refine((id) => !id.includes('..'), 'Invalid extension id');

export const Or3ExtensionManifestSchema = z.object({
    kind: ExtensionKindSchema,
    id: ExtensionIdSchema,
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    capabilities: z.array(z.string()).default([]),
});

export type Or3ExtensionManifest = z.infer<typeof Or3ExtensionManifestSchema>;

export type InstalledExtensionRecord = Or3ExtensionManifest & {
    path: string;
};
