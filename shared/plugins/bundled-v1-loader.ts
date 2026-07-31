import {
    resolveBundledPluginArtifact,
    type BundledPluginCatalog,
    type BundledPluginResolution,
} from './bundled-plugin-catalog';

export type BundledV1ModuleFactory = () => Promise<unknown>;

export type BundledV1LoaderResolution =
    | {
          readonly status: 'ready';
          readonly artifact: Extract<BundledPluginResolution, { status: 'bundled' }>['artifact'];
          readonly moduleKey: string;
          load(): Promise<unknown>;
      }
    | {
          readonly status: 'rebuild-required';
          readonly reason: 'not-in-host-build' | 'entrypoint-mismatch' | 'module-not-bundled';
      };

/** Executes only module factories captured by this host build's generated catalog. */
export class BundledV1Loader {
    constructor(
        private readonly catalog: BundledPluginCatalog,
        private readonly modules: Readonly<Record<string, BundledV1ModuleFactory>>
    ) {}

    resolve(pluginId: string, requestedClientEntry?: string): BundledV1LoaderResolution {
        const resolution = resolveBundledPluginArtifact(
            this.catalog,
            pluginId,
            requestedClientEntry
        );
        if (resolution.status === 'rebuild-required') {
            return { status: 'rebuild-required', reason: resolution.reason };
        }
        const factory = this.modules[resolution.artifact.moduleKey];
        if (!factory) {
            return { status: 'rebuild-required', reason: 'module-not-bundled' };
        }
        return {
            status: 'ready',
            artifact: resolution.artifact,
            moduleKey: resolution.artifact.moduleKey,
            load: factory,
        };
    }
}

