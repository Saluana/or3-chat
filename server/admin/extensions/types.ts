/**
 * @module server/admin/extensions/types.ts
 *
 * Purpose:
 * Defines the schemas and types for OR3 extensions. Extensions are the primary
 * mechanism for adding new functionality (plugins), visual styles (themes),
 * or administrative tools (admin-plugins) to an OR3 deployment.
 *
 * Responsibilities:
 * - Define the validation schema for `or3.manifest.json`.
 * - Provide TypeScript types for extension manifests and installation records.
 *
 * Constraints:
 * - Extension IDs must follow a strict alphanumeric pattern (including `.` `_` `-`).
 * - All extensions must specify a `kind` to determine their storage and loading path.
 */
import { z } from 'zod';
import { PluginGatePolicySchema } from '~~/shared/plugins/access-policy';

/**
 * Purpose:
 * Enumeration of supported extension types.
 *
 * - `plugin`: General workspace/chat enhancements.
 * - `theme`: CSS-driven visual customizations.
 * - `admin_plugin`: Tools restricted to the global admin dashboard.
 */
export const ExtensionKindSchema = z.enum(['plugin', 'theme', 'admin_plugin']);
export type ExtensionKind = z.infer<typeof ExtensionKindSchema>;

const RuntimeClientSchema = z.object({
    entry: z.string().min(1),
});

const RuntimeServerRouteSchema = z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: z
        .string()
        .min(1)
        .refine((value) => !value.startsWith('/'), 'Route path must be plugin-local')
        .refine((value) => !value.includes('..'), 'Invalid route path'),
    handler: z
        .string()
        .min(1)
        .refine((value) => !value.startsWith('/'), 'Handler must be relative')
        .refine((value) => !value.includes('..'), 'Invalid handler path')
        .refine(
            (value) => !/\.(?:[cm]?ts|tsx)$/i.test(value),
            'Runtime server handlers must be JavaScript files'
        ),
});

const RuntimeServerSchema = z
    .object({
        routes: z.array(RuntimeServerRouteSchema).optional(),
    })
    .superRefine((value, ctx) => {
        const routes = value.routes ?? [];
        const seen = new Set<string>();
        for (const route of routes) {
            const key = `${route.method}:${route.path}`;
            if (seen.has(key)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Duplicate runtime route declaration: ${key}`,
                });
                continue;
            }
            seen.add(key);
        }
    });

const RuntimeSchema = z.object({
    client: RuntimeClientSchema.optional(),
    server: RuntimeServerSchema.optional(),
});

/**
 * Purpose:
 * Schema for extension identifiers.
 * Enforces safe naming conventions suitable for directory names and lookup keys.
 * Exported so every install/uninstall/API boundary reuses one canonical validator.
 */
export const ExtensionIdSchema = z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9._-]+$/, 'Invalid extension id')
    .refine((id) => !id.includes('..'), 'Invalid extension id');

export type ExtensionId = z.infer<typeof ExtensionIdSchema>;
/**
 * Purpose:
 * The source-of-truth schema for `or3.manifest.json`.
 * Every extension package MUST include this file in its root.
 *
 * Key fields:
 * - `kind`: The category of extension.
 * - `id`: Unique identifier (used as directory name).
 * - `name`: Human-readable name.
 * - `version`: SemVer string.
 * - `capabilities`: Optional array of feature flags the extension requires.
 */
export const Or3ExtensionManifestSchema = z.object({
    kind: ExtensionKindSchema,
    id: ExtensionIdSchema,
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    capabilities: z.array(z.string()).default([]),
    access: PluginGatePolicySchema.optional(),
    runtime: RuntimeSchema.optional(),
});

export type Or3ExtensionManifest = z.infer<typeof Or3ExtensionManifestSchema>;

/**
 * Purpose:
 * Represents an extension that has been successfully extracted to the disk.
 * Includes the absolute path for dynamic loading.
 */
export type InstalledExtensionRecord = Or3ExtensionManifest & {
    path: string;
};
