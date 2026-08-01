import { getPluginGateDecision } from '~/utils/plugins/access-gate';
import { reportError } from '~/utils/errors';
import { getPaletteCommand, getPaletteSource } from './registry';
import { emitPaletteTelemetry } from './telemetry';
import type {
    PaletteAction,
    PaletteActionResult,
    PaletteHostContext,
} from './types';

export interface ExecutePaletteActionOptions {
    host: PaletteHostContext;
    action: PaletteAction;
    /** Optional source id for access/plugin generation recheck. */
    sourceId?: string;
    expectedPluginGeneration?: number;
}

/**
 * Central action executor: validates access/plugin generation, dispatches to host,
 * and normalizes errors to PaletteActionResult.
 */
export async function executePaletteAction(
    options: ExecutePaletteActionOptions
): Promise<PaletteActionResult> {
    const started = performance.now();
    const { host, action } = options;

    if (action.disabled) {
        const result: PaletteActionResult = {
            ok: false,
            error: {
                code: 'disabled',
                message: action.disabledReason || 'Action is disabled',
            },
        };
        emitFailure(started, result);
        return result;
    }

    if (options.sourceId) {
        const source = getPaletteSource(options.sourceId, {
            includeInaccessible: true,
        });
        if (!source) {
            const result: PaletteActionResult = {
                ok: false,
                error: {
                    code: 'not-found',
                    message: `Source "${options.sourceId}" is no longer available`,
                },
            };
            emitFailure(started, result);
            return result;
        }
        if (
            source.access &&
            !getPluginGateDecision(source.pluginId, source.access).allowed
        ) {
            const result: PaletteActionResult = {
                ok: false,
                error: {
                    code: 'forbidden',
                    message: 'Source is no longer accessible',
                },
            };
            emitFailure(started, result);
            return result;
        }
        if (
            typeof options.expectedPluginGeneration === 'number' &&
            options.expectedPluginGeneration !== source.pluginGeneration
        ) {
            const result: PaletteActionResult = {
                ok: false,
                error: {
                    code: 'stale-plugin',
                    message: 'Plugin contribution is stale',
                },
            };
            emitFailure(started, result);
            return result;
        }
    }

    if (action.target.kind === 'command') {
        const command = getPaletteCommand(action.target.commandId, {
            includeInaccessible: true,
        });
        if (!command) {
            const result: PaletteActionResult = {
                ok: false,
                error: {
                    code: 'not-found',
                    message: `Command "${action.target.commandId}" is no longer available`,
                },
            };
            emitFailure(started, result);
            return result;
        }
        if (
            command.access &&
            !getPluginGateDecision(command.pluginId, command.access).allowed
        ) {
            const result: PaletteActionResult = {
                ok: false,
                error: {
                    code: 'forbidden',
                    message: 'Command is no longer accessible',
                },
            };
            emitFailure(started, result);
            return result;
        }
        if (
            typeof action.target.expectedPluginGeneration === 'number' &&
            action.target.expectedPluginGeneration !== command.pluginGeneration
        ) {
            const result: PaletteActionResult = {
                ok: false,
                error: {
                    code: 'stale-plugin',
                    message: 'Plugin command contribution is stale',
                },
            };
            emitFailure(started, result);
            return result;
        }
    }

    try {
        const result = await dispatch(host, action);
        emitPaletteTelemetry({
            kind: 'action',
            durationMs: performance.now() - started,
            outcome: result.ok ? 'success' : 'failure',
            errorCategory: result.ok ? undefined : result.error.code,
            counts: { closeOnSuccess: result.ok && result.closeOnSuccess !== false ? 1 : 0 },
        });
        if (!result.ok) {
            reportError(result.error.cause ?? result.error.message, {
                code: 'ERR_INTERNAL',
                tags: {
                    source: 'command-palette',
                    paletteError: result.error.code,
                },
            });
        }
        return result;
    } catch (error) {
        const result: PaletteActionResult = {
            ok: false,
            error: {
                code: 'execution-failed',
                message:
                    error instanceof Error ? error.message : 'Action failed',
                cause: error,
            },
        };
        emitFailure(started, result);
        reportError(error, {
            code: 'ERR_INTERNAL',
            tags: { source: 'command-palette' },
        });
        return result;
    }
}

async function dispatch(
    host: PaletteHostContext,
    action: PaletteAction
): Promise<PaletteActionResult> {
    const target = action.target;
    switch (target.kind) {
        case 'chat':
            return host.openChat(target.threadId, target.destination);
        case 'document':
            return host.openDocument(target.documentId, target.destination);
        case 'pane-app':
            return host.openPaneApp(
                target.appId,
                target.recordId,
                target.destination
            );
        case 'project':
            return host.revealProject(target.projectId);
        case 'system-prompt':
            return host.openSystemPrompts({
                mode: target.mode,
                promptId: target.promptId,
            });
        case 'dashboard':
            return host.openDashboard(target.pluginId, target.pageId);
        case 'image':
            return host.openImage(target.hash);
        case 'workspace-tab':
            return host.openWorkspaceTab
                ? host.openWorkspaceTab(target.tabId)
                : {
                      ok: false,
                      error: {
                          code: 'navigation-failed',
                          message: 'Workspace tab host unavailable',
                      },
                  };
        case 'command':
            return host.executeCommand(target.commandId);
        default: {
            const _exhaustive: never = target;
            return {
                ok: false,
                error: {
                    code: 'execution-failed',
                    message: `Unknown action target: ${String(_exhaustive)}`,
                },
            };
        }
    }
}

function emitFailure(started: number, result: Extract<PaletteActionResult, { ok: false }>): void {
    emitPaletteTelemetry({
        kind: 'action',
        durationMs: performance.now() - started,
        outcome: 'failure',
        errorCategory: result.error.code,
    });
}
