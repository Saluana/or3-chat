import { z } from 'zod';
import { resolveBundledPluginArtifact, type BundledPluginCatalog } from './bundled-plugin-catalog';
import { createDescriptorKey } from './descriptor-key';
import type { BundledV1PluginDescriptor } from './runtime-descriptor';

const Sha256Schema = z.string().regex(/^sha256-[a-f0-9]{64}$/);

const BundledArtifactSchema = z
    .object({
        kind: z.literal('bundled-v1'),
        hostBuildId: z.string().min(1),
        moduleKey: z.string().min(1),
        rebuildRequired: z.literal(true),
    })
    .strict();

const BundledDescriptorSchema = z
    .object({
        id: z.string().min(1),
        version: z.string().min(1),
        manifestVersion: z.literal(1),
        pluginApiVersion: z.string().min(1),
        source: z.enum(['builtin', 'extension']),
        trust: z.literal('trusted-host'),
        workspaceId: z.string().min(1),
        policyRevision: z.string().min(1),
        grantsRevision: z.string().min(1),
        resolvedDependencyKeys: z.array(z.string().min(1)),
        artifact: BundledArtifactSchema,
        descriptorKey: Sha256Schema,
    })
    .strict();

const RuntimeEntryEnvelopeSchema = z
    .object({
        clientEntry: z.string().min(1).optional(),
        hasServerRoutes: z.boolean(),
        loadAllowed: z.boolean(),
        loadDeniedReason: z.string().min(1).optional(),
        lifecycleCoverage: z.enum([
            'managed-v2',
            'managed-v1-api',
            'legacy-global-possible',
        ]),
        descriptorStatus: z.enum(['ready', 'rebuild-required']),
        descriptor: z.unknown().optional(),
        rebuildRequiredReason: z
            .enum(['not-in-host-build', 'entrypoint-mismatch'])
            .optional(),
    })
    .passthrough();

export type DescriptorBlockCode =
    | 'malformed-runtime-entry'
    | 'load-denied'
    | 'rebuild-required'
    | 'plugin-id-mismatch'
    | 'workspace-id-mismatch'
    | 'catalog-artifact-mismatch'
    | 'descriptor-key-mismatch';

export interface DescriptorBlock {
    readonly code: DescriptorBlockCode;
    readonly message: string;
    readonly retryable: boolean;
}

export type DescriptorResolution =
    | { readonly status: 'ready'; readonly descriptor: BundledV1PluginDescriptor }
    | { readonly status: 'blocked'; readonly failure: DescriptorBlock };

export interface ResolveBundledDescriptorInput {
    readonly pluginId: string;
    readonly workspaceId: string;
    readonly runtimeEntry: unknown;
}

function blocked(
    code: DescriptorBlockCode,
    message: string,
    retryable = false
): DescriptorResolution {
    return { status: 'blocked', failure: { code, message, retryable } };
}

export interface DescriptorResolver {
    resolveBundled(input: ResolveBundledDescriptorInput): Promise<DescriptorResolution>;
}

/** Create a client resolver bound to the immutable catalog from this host build. */
export function createDescriptorResolver(catalog: BundledPluginCatalog): DescriptorResolver {
    return {
        async resolveBundled(input) {
            const envelope = RuntimeEntryEnvelopeSchema.safeParse(input.runtimeEntry);
            if (!envelope.success) {
                return blocked('malformed-runtime-entry', 'Runtime descriptor envelope is invalid');
            }
            if (!envelope.data.loadAllowed) {
                return blocked(
                    'load-denied',
                    envelope.data.loadDeniedReason ?? 'Server denied plugin runtime loading'
                );
            }
            if (envelope.data.descriptorStatus === 'rebuild-required') {
                return blocked(
                    'rebuild-required',
                    envelope.data.rebuildRequiredReason ?? 'Plugin is absent from this host build'
                );
            }

            const parsed = BundledDescriptorSchema.safeParse(envelope.data.descriptor);
            if (!parsed.success) {
                return blocked('malformed-runtime-entry', 'Bundled plugin descriptor is invalid');
            }
            const descriptor = parsed.data as BundledV1PluginDescriptor;
            if (descriptor.id !== input.pluginId) {
                return blocked('plugin-id-mismatch', 'Descriptor plugin identity does not match');
            }
            if (descriptor.workspaceId !== input.workspaceId) {
                return blocked('workspace-id-mismatch', 'Descriptor workspace identity does not match');
            }

            const catalogResolution = resolveBundledPluginArtifact(
                catalog,
                input.pluginId,
                envelope.data.clientEntry
            );
            if (
                catalogResolution.status !== 'bundled' ||
                descriptor.artifact.hostBuildId !== catalogResolution.artifact.hostBuildId ||
                descriptor.artifact.moduleKey !== catalogResolution.artifact.moduleKey
            ) {
                return blocked(
                    'catalog-artifact-mismatch',
                    'Descriptor artifact is not executable in this host build'
                );
            }

            const { descriptorKey, ...identity } = descriptor;
            if ((await createDescriptorKey(identity)) !== descriptorKey) {
                return blocked('descriptor-key-mismatch', 'Descriptor key verification failed');
            }
            return { status: 'ready', descriptor };
        },
    };
}
