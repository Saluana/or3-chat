export type ModuleLoaderV2RuntimeMode = 'ssr' | 'static' | 'unknown';

export type ModuleLoaderV2Status = {
    readonly enabled: boolean;
    readonly mode: ModuleLoaderV2RuntimeMode;
    readonly packagesSupported: boolean;
    readonly reason:
        | 'enabled'
        | 'flag-off'
        | 'static-build-unsupported'
        | 'safe-mode';
    readonly message: string;
};

/**
 * Explains whether digest-addressed V2 packages can load in the current host.
 * Static output has no runtime asset service, so packages stay rebuild-required.
 */
export function resolveModuleLoaderV2Status(input: {
    readonly enabled: boolean;
    readonly mode: ModuleLoaderV2RuntimeMode;
    readonly safeMode?: boolean;
}): ModuleLoaderV2Status {
    if (input.safeMode) {
        return Object.freeze({
            enabled: input.enabled,
            mode: input.mode,
            packagesSupported: false,
            reason: 'safe-mode',
            message:
                'Non-core plugin discovery is disabled before import; V2 packages are not loaded',
        });
    }
    if (!input.enabled) {
        return Object.freeze({
            enabled: false,
            mode: input.mode,
            packagesSupported: false,
            reason: 'flag-off',
            message:
                'ModuleV2Loader is off; bundled V1 plugins remain available through BundledV1Loader',
        });
    }
    if (input.mode === 'static') {
        return Object.freeze({
            enabled: true,
            mode: 'static',
            packagesSupported: false,
            reason: 'static-build-unsupported',
            message:
                'Static generation has no runtime package asset service; V2 packages require rebuild or an SSR host',
        });
    }
    return Object.freeze({
        enabled: true,
        mode: input.mode,
        packagesSupported: true,
        reason: 'enabled',
        message: 'Digest-addressed V2 packages may load through ModuleV2Loader',
    });
}
