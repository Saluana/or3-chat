import {
    createV2Package as createSdkPackage,
    type CreateCommandOptions,
} from '../../../packages/plugin-sdk/src/cli/create';

export type { CreateCommandOptions };

/**
 * Host `create` delegates to the SDK CLI and pins the trusted-host
 * `minimal-v2` starter so in-repo behavior is unchanged. External consumers
 * get the portable starter by running the shipped `or3-plugin` binary.
 */
export function createV2Package(options: CreateCommandOptions): {
    readonly root: string;
    readonly pluginId: string;
} {
    return createSdkPackage({ ...options, template: options.template ?? 'minimal-v2' });
}
