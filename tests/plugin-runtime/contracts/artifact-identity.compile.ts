import type {
    BundledV1ArtifactIdentity,
    PackageV2ArtifactIdentity,
    PluginDescriptor,
} from '../../../shared/plugins/runtime-descriptor';

const bundled: BundledV1ArtifactIdentity = {
    kind: 'bundled-v1',
    hostBuildId: 'host-build-1',
    moduleKey: '/extensions/plugins/example/plugin.client.ts',
    rebuildRequired: true,
};

const packaged: PackageV2ArtifactIdentity = {
    kind: 'package-v2',
    packageDigest: 'sha256-deadbeef',
    clientEntry: 'client/main.js',
    serverRoutes: [{ method: 'GET', path: 'ping', handler: 'server/ping.js' }],
};

const bundledWithDigest: BundledV1ArtifactIdentity = {
    ...bundled,
    // @ts-expect-error A bundled module cannot claim package digest identity.
    packageDigest: 'sha256-not-allowed',
};

const bundledWithPostBuildReload: BundledV1ArtifactIdentity = {
    ...bundled,
    // @ts-expect-error Bundled bytes remain tied to the host build.
    rebuildRequired: false,
};

const packageWithModuleKey: PackageV2ArtifactIdentity = {
    ...packaged,
    // @ts-expect-error A package cannot claim a host-bundled module key.
    moduleKey: '/extensions/plugins/not-allowed/plugin.client.ts',
};

// @ts-expect-error Package source requires a package-v2 descriptor branch.
const descriptorWithMismatchedSource: PluginDescriptor = {
    id: 'example',
    version: '1.0.0',
    manifestVersion: 1,
    pluginApiVersion: '1',
    source: 'package',
    trust: 'trusted-host',
    workspaceId: 'workspace-1',
    policyRevision: 'policy-1',
    grantsRevision: 'grants-1',
    resolvedDependencyKeys: [],
    artifact: bundled,
    descriptorKey: 'sha256-descriptor',
};

void [bundled, packaged, bundledWithDigest, bundledWithPostBuildReload, packageWithModuleKey, descriptorWithMismatchedSource];
