import type { UseMultiPaneApi } from '~/composables/core/useMultiPane';
import type { WorkspaceResource } from '~/core/workspace-tabs/types';

export interface PaneActivation {
    readonly paneId: string;
    readonly generation: number;
    readonly signal: AbortSignal;
    isCurrent(): boolean;
}

export interface WorkspaceTabHost {
    paneIds(): string[];
    activePaneId(): string | null;
    focusPane(paneId: string): void;
    addPane(): string | null;
    closePane(paneId: string): Promise<void>;
    bindResourceToPane(
        paneId: string,
        resource: WorkspaceResource,
        activation: PaneActivation
    ): Promise<void>;
}

/** Abort wasteful work and reject late async completion for every pane. */
export function createPaneActivationCoordinator() {
    const generations = new Map<string, number>();
    const controllers = new Map<string, AbortController>();

    function begin(paneId: string): PaneActivation {
        controllers.get(paneId)?.abort(
            new DOMException('Superseded tab activation', 'AbortError')
        );
        const controller = new AbortController();
        controllers.set(paneId, controller);
        const generation = (generations.get(paneId) ?? 0) + 1;
        generations.set(paneId, generation);
        const isCurrent = () =>
            generations.get(paneId) === generation &&
            controllers.get(paneId) === controller &&
            !controller.signal.aborted;
        return { paneId, generation, signal: controller.signal, isCurrent };
    }

    function cancel(paneId: string): void {
        controllers.get(paneId)?.abort(
            new DOMException('Pane was closed', 'AbortError')
        );
        controllers.delete(paneId);
        generations.set(paneId, (generations.get(paneId) ?? 0) + 1);
    }

    return { begin, cancel };
}

/**
 * Narrow adapter between the tab session and the existing visible-pane engine.
 * It deliberately does not own messages or document content.
 */
export function useWorkspaceTabHost(multiPane: UseMultiPaneApi): WorkspaceTabHost {
    function getPaneIndex(paneId: string): number {
        return multiPane.getPaneIndexById(paneId);
    }

    async function bindResourceToPane(
        paneId: string,
        resource: WorkspaceResource,
        activation: PaneActivation
    ): Promise<void> {
        const index = getPaneIndex(paneId);
        if (index < 0 || !activation.isCurrent()) return;

        if (resource.kind === 'chat') {
            multiPane.updatePane(index, {
                mode: 'chat',
                documentId: undefined,
                messages: [],
            });
            await multiPane.setPaneThread(index, resource.threadId ?? '');
            return;
        }

        if (resource.kind === 'document') {
            multiPane.updatePane(index, {
                mode: 'doc',
                documentId: resource.documentId,
                threadId: '',
                messages: [],
            });
            return;
        }

        await multiPane.setPaneApp(index, resource.appId, {
            recordId: resource.recordId,
        });
    }

    return {
        paneIds: () => multiPane.panes.value.map((pane) => pane.id),
        activePaneId: () => multiPane.activePaneId.value,
        focusPane(paneId) {
            const index = getPaneIndex(paneId);
            if (index >= 0) multiPane.setActive(index);
        },
        addPane: () => multiPane.addPane(),
        async closePane(paneId) {
            const index = getPaneIndex(paneId);
            if (index >= 0) await multiPane.closePane(index);
        },
        bindResourceToPane,
    };
}
