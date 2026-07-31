import type {
    PluginCommandPaletteCommandDefinition,
    PluginCommandPalettePostSourceDefinition,
    PluginContribution,
} from '@or3/plugin-sdk';
import {
    registerPaletteCommand,
} from './registry';
import { registerPluginPostSource } from './sources/register-core';
import {
    executeMediatedPaletteCommand,
    registerMediatedPaletteCommand,
} from './mediated-commands';
import type { PaletteCommandHandler } from './types';
import type { RegistrationHandle } from '~~/shared/plugins/registration-handle';
import type {
    HostRpcHandler,
    HostRpcHandlerContext,
} from '~~/shared/plugins/isolation/host-rpc-broker';

/**
 * Map a V2 contribution onto the command-palette registry.
 * Isolated plugins contribute declarative metadata; command handlers are
 * registered through the mediated channel when provided by a trusted host adapter.
 */
export function mapV2PaletteContribution(options: {
    pluginId: string;
    generation: number;
    contribution: PluginContribution;
    commandHandler?: PaletteCommandHandler;
}): RegistrationHandle | null {
    const { pluginId, generation, contribution } = options;

    if (contribution.kind === 'ui.command-palette.post-source') {
        const definition =
            contribution.definition as PluginCommandPalettePostSourceDefinition;
        return registerPluginPostSource({
            definition: {
                id: definition.id,
                label: definition.label,
                postType: definition.postType,
                categoryId: definition.categoryId,
                filterAliases: definition.filterAliases,
                icon: definition.icon,
                order: definition.order,
                metaKeys: definition.metaKeys,
                openTarget: definition.openTarget,
            },
            pluginId,
            pluginGeneration: generation,
        });
    }

    if (contribution.kind === 'ui.command-palette.command') {
        const definition =
            contribution.definition as PluginCommandPaletteCommandDefinition;
        const mediatedDispose = options.commandHandler
            ? registerMediatedPaletteCommand({
                  commandId: definition.id,
                  pluginId,
                  generation,
                  handler: options.commandHandler,
              })
            : () => undefined;

        const handler: PaletteCommandHandler = options.commandHandler
            ? () =>
                  executeMediatedPaletteCommand({
                      commandId: definition.id,
                      pluginId,
                      expectedGeneration: generation,
                  })
            : async () => ({
                  ok: false,
                  error: {
                      code: 'execution-failed',
                      message:
                          'Isolated command requires a mediated host handler',
                  },
              });

        const handle = registerPaletteCommand(
            {
                id: definition.id,
                label: definition.label,
                description: definition.description,
                keywords: definition.keywords,
                icon: definition.icon,
                order: definition.order,
                closeOnSuccess: definition.closeOnSuccess,
            },
            handler,
            { pluginId, pluginGeneration: generation }
        );

        return {
            id: definition.id,
            owner: handle.owner,
            get disposed() {
                return handle.disposed;
            },
            dispose() {
                mediatedDispose();
                return handle.dispose();
            },
        };
    }

    return null;
}

export interface V2PaletteContributionHost {
    readonly contribute: HostRpcHandler;
    dispose(): void;
}

/**
 * Production host adapter for trusted and isolated V2 contribution bridges.
 * The RPC context supplies plugin identity/generation; caller input cannot.
 */
export function createV2PaletteContributionHost(options?: {
    executeCommand?: (input: {
        pluginId: string;
        generation: number;
        commandId: string;
    }) => ReturnType<PaletteCommandHandler>;
}): V2PaletteContributionHost {
    const handles = new Map<string, RegistrationHandle>();

    const contribute: HostRpcHandler = (params, context) => {
        const contribution = parsePaletteContribution(params);
        const key = contributionKey(context, contribution);
        const handle = mapV2PaletteContribution({
            pluginId: context.pluginId,
            generation: context.generation,
            contribution,
            commandHandler:
                contribution.kind === 'ui.command-palette.command' &&
                options?.executeCommand
                    ? () =>
                          options.executeCommand!({
                              pluginId: context.pluginId,
                              generation: context.generation,
                              commandId: contribution.id,
                          })
                    : undefined,
        });
        if (!handle) {
            throw new Error(
                `Unsupported command-palette contribution kind "${contribution.kind}"`
            );
        }
        const previous = handles.get(key);
        handles.set(key, handle);
        previous?.dispose();
        context.signal.addEventListener(
            'abort',
            () => {
                if (handles.get(key) !== handle) return;
                handles.delete(key);
                handle.dispose();
            },
            { once: true }
        );
        return { accepted: true, id: contribution.id };
    };

    return {
        contribute,
        dispose() {
            for (const handle of handles.values()) handle.dispose();
            handles.clear();
        },
    };
}

function parsePaletteContribution(
    params: Readonly<Record<string, unknown>>
): PluginContribution {
    const raw =
        params.contribution && typeof params.contribution === 'object'
            ? params.contribution
            : params;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Command-palette contribution must be an object');
    }
    const value = raw as Partial<PluginContribution>;
    if (
        value.kind !== 'ui.command-palette.post-source' &&
        value.kind !== 'ui.command-palette.command'
    ) {
        throw new Error('Unsupported command-palette contribution kind');
    }
    if (
        typeof value.id !== 'string' ||
        !value.definition ||
        typeof value.definition !== 'object'
    ) {
        throw new Error('Contribution requires id and declarative definition');
    }
    const definitionId = (value.definition as { id?: unknown }).id;
    if (definitionId !== value.id) {
        throw new Error('Contribution id must match definition.id');
    }
    return value as PluginContribution;
}

function contributionKey(
    context: HostRpcHandlerContext,
    contribution: PluginContribution
): string {
    return `${context.pluginId}:${contribution.kind}:${contribution.id}`;
}
