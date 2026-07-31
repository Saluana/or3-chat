import type { BundledV1PluginDescriptor } from './runtime-descriptor';

export type BundledV1DescriptorChange =
    | 'workspace'
    | 'policy'
    | 'grants'
    | 'host-build'
    | 'module'
    | 'source'
    | 'dependencies'
    | 'version-metadata'
    | 'api-version'
    | 'manifest-version'
    | 'descriptor-key';

export type BundledV1Diff =
    | { readonly action: 'none'; readonly changes: readonly [] }
    | { readonly action: 'start'; readonly changes: readonly [] }
    | { readonly action: 'stop'; readonly changes: readonly [] }
    | {
          readonly action: 'replace';
          readonly changes: readonly BundledV1DescriptorChange[];
      }
    | {
          readonly action: 'rebuild-required';
          readonly reason: 'disk-only-change' | 'metadata-without-new-host-build';
          readonly changes: readonly BundledV1DescriptorChange[];
      };

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Compares executable identity separately from mutable disk metadata. Bundled
 * V1 code can only change when the generated host build/module identity does.
 */
export function diffBundledV1Descriptors(input: {
    active?: BundledV1PluginDescriptor;
    desired?: BundledV1PluginDescriptor;
    diskOnlyChangeDetected?: boolean;
}): BundledV1Diff {
    const { active, desired } = input;
    if (!active && !desired) return { action: 'none', changes: [] };
    if (!active) return { action: 'start', changes: [] };
    if (!desired) return { action: 'stop', changes: [] };
    if (input.diskOnlyChangeDetected) {
        return { action: 'rebuild-required', reason: 'disk-only-change', changes: [] };
    }
    if (active.descriptorKey === desired.descriptorKey) {
        return { action: 'none', changes: [] };
    }

    const changes: BundledV1DescriptorChange[] = [];
    if (active.workspaceId !== desired.workspaceId) changes.push('workspace');
    if (active.policyRevision !== desired.policyRevision) changes.push('policy');
    if (active.grantsRevision !== desired.grantsRevision) changes.push('grants');
    if (active.artifact.hostBuildId !== desired.artifact.hostBuildId) changes.push('host-build');
    if (active.artifact.moduleKey !== desired.artifact.moduleKey) changes.push('module');
    if (active.source !== desired.source) changes.push('source');
    if (!sameStrings(active.resolvedDependencyKeys, desired.resolvedDependencyKeys)) {
        changes.push('dependencies');
    }
    if (active.version !== desired.version) changes.push('version-metadata');
    if (active.pluginApiVersion !== desired.pluginApiVersion) changes.push('api-version');
    if (active.manifestVersion !== desired.manifestVersion) changes.push('manifest-version');
    if (changes.length === 0) changes.push('descriptor-key');

    const executableChanged = changes.some(
        (change) => change === 'host-build' || change === 'module'
    );
    const contextChanged = changes.some((change) =>
        ['workspace', 'policy', 'grants', 'source', 'dependencies'].includes(change)
    );
    const metadataOnly = changes.every((change) =>
        ['version-metadata', 'api-version', 'manifest-version', 'descriptor-key'].includes(change)
    );
    if (!executableChanged && !contextChanged && metadataOnly) {
        return {
            action: 'rebuild-required',
            reason: 'metadata-without-new-host-build',
            changes: Object.freeze(changes),
        };
    }
    return { action: 'replace', changes: Object.freeze(changes) };
}

