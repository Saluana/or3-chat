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
import { valid, validRange } from 'semver';
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

const V2PluginIdSchema = z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'V2 plugin id must be lowercase and path-safe')
    .refine((id) => !id.includes('..'), 'Invalid V2 plugin id');

const PackagePathSchema = z
    .string()
    .min(1)
    .refine(
        (value) => !value.startsWith('/') && !value.includes('\\'),
        'Package path must be relative'
    )
    .refine(
        (value) =>
            value
                .split('/')
                .every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
        'Package path contains an invalid segment'
    );

const ExecutablePackagePathSchema = PackagePathSchema.refine(
    (value) => /\.(?:mjs|js)$/i.test(value),
    'V2 runtime entrypoints must be JavaScript ESM files'
);

const V2RuntimeClientSchema = z
    .object({
        entry: ExecutablePackagePathSchema,
        format: z.literal('esm'),
        isolation: z.enum(['host', 'iframe', 'worker']),
    })
    .strict();

const V2RuntimeServerRouteSchema = z
    .object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        path: z
            .string()
            .min(1)
            .refine((value) => !value.startsWith('/'), 'Route path must be plugin-local')
            .refine((value) => !value.includes('..'), 'Invalid route path'),
        handler: ExecutablePackagePathSchema,
        permission: z.string().min(1).optional(),
    })
    .strict();

const V2RuntimeServerSchema = z
    .object({
        entry: ExecutablePackagePathSchema.optional(),
        routes: z.array(V2RuntimeServerRouteSchema).default([]),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (value.routes.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'V2 server runtime must declare at least one route',
            });
        }
        const seen = new Set<string>();
        for (const route of value.routes) {
            const key = `${route.method}:${route.path}`;
            if (seen.has(key)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Duplicate runtime route declaration: ${key}`,
                });
            }
            seen.add(key);
        }
    });

const V2RuntimeSchema = z
    .object({
        client: V2RuntimeClientSchema.optional(),
        server: V2RuntimeServerSchema.optional(),
    })
    .strict()
    .refine((value) => Boolean(value.client || value.server), {
        message: 'V2 runtime must declare a client or server entrypoint',
    });

const V2GrantSchema = z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/, 'Invalid plugin grant');

const V2FeatureSchema = z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/, 'Invalid dependency feature');

const V2FeatureNegotiationSchema = z
    .object({
        required: z.array(V2FeatureSchema),
        optional: z.array(V2FeatureSchema),
    })
    .strict()
    .superRefine((value, ctx) => {
        const required = new Set(value.required);
        if (
            required.size !== value.required.length ||
            new Set(value.optional).size !== value.optional.length
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Negotiated features must be unique',
            });
        }
        for (const feature of value.optional) {
            if (required.has(feature)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['optional'],
                    message: `Feature cannot be both required and optional: ${feature}`,
                });
            }
        }
    });

const SemverRangeSchema = z
    .string()
    .trim()
    .min(1)
    .refine((value) => validRange(value) !== null, 'Invalid semantic version range');

const V2DependencySchema = z
    .object({
        id: V2PluginIdSchema,
        range: SemverRangeSchema,
        features: z.array(V2FeatureSchema).default([]),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (new Set(value.features).size !== value.features.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['features'],
                message: 'Dependency features must be unique',
            });
        }
    });

const V2DependenciesSchema = z
    .object({
        required: z.array(V2DependencySchema),
        optional: z.array(V2DependencySchema),
    })
    .strict()
    .superRefine((value, ctx) => {
        const seen = new Set<string>();
        for (const [group, dependencies] of Object.entries(value)) {
            for (const dependency of dependencies) {
                if (seen.has(dependency.id)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: [group],
                        message: `Duplicate dependency declaration: ${dependency.id}`,
                    });
                }
                seen.add(dependency.id);
            }
        }
    });

const V2SettingsSchema = z
    .object({
        schema: PackagePathSchema.refine((value) => value.endsWith('.json'), {
            message: 'Settings schema must be a JSON package path',
        }).optional(),
        version: z.number().int().min(1),
    })
    .strict();

const V2StateCompatibilitySchema = z
    .object({
        version: z.number().int().min(1),
        reads: z
            .object({
                minimum: z.number().int().min(1),
                maximum: z.number().int().min(1),
            })
            .strict(),
        rollback: z.enum(['safe', 'migration-required', 'unsupported']),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (value.reads.minimum > value.reads.maximum) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['reads'],
                message: 'Readable state version minimum cannot exceed maximum',
            });
        }
        if (value.version < value.reads.minimum || value.version > value.reads.maximum) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['version'],
                message: 'Current state version must be readable by this package',
            });
        }
    });

const V2IntegritySchema = z
    .object({
        package: z.string().regex(/^sha256-[a-f0-9]{64}$/, 'Invalid package integrity'),
    })
    .strict();

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
        kind: z.literal('plugin'),
        id: V2PluginIdSchema,
        version: z.string().refine((value) => valid(value) !== null, 'Invalid semantic version'),
        engines: z
            .object({
                or3: SemverRangeSchema,
                pluginApi: SemverRangeSchema,
            })
            .strict(),
        runtime: V2RuntimeSchema,
        requestedGrants: z.array(V2GrantSchema),
        features: V2FeatureNegotiationSchema,
        dependencies: V2DependenciesSchema,
        trust: z.enum(['trusted-host', 'isolated-client', 'isolated-server']),
        settings: V2SettingsSchema,
        stateCompatibility: V2StateCompatibilitySchema,
        integrity: V2IntegritySchema.optional(),
        manifestVersion: z.literal(2),
    })
    .strict()
    .superRefine((value, ctx) => {
        if (new Set(value.requestedGrants).size !== value.requestedGrants.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['requestedGrants'],
                message: 'Requested grants must be unique',
            });
        }
        if (
            value.trust === 'trusted-host' &&
            value.runtime.client?.isolation !== undefined &&
            value.runtime.client.isolation !== 'host'
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['runtime', 'client', 'isolation'],
                message: 'Trusted-host plugins must use host client isolation',
            });
        }
        if (value.trust === 'isolated-client') {
            if (!value.runtime.client) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['runtime', 'client'],
                    message: 'Isolated-client plugins must declare a client entrypoint',
                });
            } else if (value.runtime.client.isolation === 'host') {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['runtime', 'client', 'isolation'],
                    message: 'Isolated-client plugins cannot use host isolation',
                });
            }
        }
        if (value.trust === 'isolated-server' && !value.runtime.server) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['runtime', 'server'],
                message: 'Isolated-server plugins must declare a server entrypoint',
            });
        }
    });

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
