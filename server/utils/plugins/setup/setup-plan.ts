/**
 * Host setup service: joins an installed package's descriptors with the stored
 * connection state for one workspace and produces a renderable setup plan.
 */

import {
    buildSetupPlan,
    type SetupConnectionState,
    type SetupPlan,
} from '~~/shared/plugins/setup/plan';
import type { PluginConnectionService } from '../connections/service';
import { loadPackageDescriptors } from './load-descriptors';

export interface SetupPlanResult {
    readonly plan: SetupPlan | null;
    readonly problems: readonly string[];
}

export async function resolveSetupPlan(input: {
    readonly extensionsBaseDir: string;
    readonly packagePath: string;
    readonly pluginId: string;
    readonly workspaceId: string;
    /** Acting owner; connection state is only visible to its owner. */
    readonly ownerUserId: string;
    readonly service: PluginConnectionService;
    readonly values?: Readonly<Record<string, string | number | boolean>>;
}): Promise<SetupPlanResult> {
    const descriptors = await loadPackageDescriptors({
        extensionsBaseDir: input.extensionsBaseDir,
        packagePath: input.packagePath,
    });
    if (!descriptors.setup || !descriptors.policy) {
        return { plan: null, problems: descriptors.problems };
    }

    const stored = await input.service.list({
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        pluginId: input.pluginId,
    });

    const connectionStates: SetupConnectionState[] = [];
    for (const connection of stored) {
        connectionStates.push({
            connectionId: connection.id,
            ref: connection.ref,
            scopes: connection.scopes,
            testPassed: await input.service.isTestCurrent(connection.id),
            mechanismSatisfied: true,
        });
    }

    const plan = buildSetupPlan({
        setup: descriptors.setup,
        policy: descriptors.policy,
        connectionStates,
        ...(input.values === undefined ? {} : { values: input.values }),
    });

    return { plan, problems: descriptors.problems };
}
