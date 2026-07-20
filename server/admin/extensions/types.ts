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
const Or3ExtensionManifestFields = {
    kind: ExtensionKindSchema,
    id: ExtensionIdSchema,
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    capabilities: z.array(z.string()).default([]),
    access: PluginGatePolicySchema.optional(),
    runtime: RuntimeSchema.optional(),
    themeTrust: z.enum(['declarative', 'trusted-code']).optional(),
    componentContractVersion: z.literal(1).optional(),
};

/**
 * Frozen compatible parser for manifests created before Manifest V2.
 *
 * `manifestVersion` is a dispatcher input only: omitting it, setting it to
 * `null`, or explicitly selecting `1` all preserve the prior normalized V1
 * output. Unknown V1 keys continue to be stripped by Zod's default object
 * behavior.
 */
export const Or3ExtensionManifestV1Schema = z
    .object({
        ...Or3ExtensionManifestFields,
        manifestVersion: z.union([z.literal(1), z.null()]).optional(),
    })
    .transform(({ manifestVersion: _manifestVersion, ...manifest }) => manifest);

/**
 * Strict parser boundary for Manifest V2 packages.
 * V2-only contract fields are added explicitly as the package contract grows;
 * undeclared fields are rejected rather than silently stripped.
 */
export const Or3ExtensionManifestV2Schema = z
    .object({
        ...Or3ExtensionManifestFields,
        manifestVersion: z.literal(2),
    })
    .strict();

/** Dispatches with `manifestVersion ?? 1` while preventing V2 fallback to V1. */
export const Or3ExtensionManifestSchema = z.union([
    Or3ExtensionManifestV2Schema,
    Or3ExtensionManifestV1Schema,
]);

export type Or3ExtensionManifest = z.infer<typeof Or3ExtensionManifestSchema>;
export type Or3ExtensionManifestV1 = z.infer<typeof Or3ExtensionManifestV1Schema>;
export type Or3ExtensionManifestV2 = z.infer<typeof Or3ExtensionManifestV2Schema>;

/**
 * Purpose:
 * Represents an extension that has been successfully extracted to the disk.
 * Includes the absolute path for dynamic loading.
 */
export type InstalledExtensionRecord = Or3ExtensionManifest & {
    path: string;
};
