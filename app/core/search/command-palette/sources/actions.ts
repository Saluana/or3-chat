import type { PaletteAction, PaletteLoadContext } from '../types';

export function chatActions(
    threadId: string,
    context: PaletteLoadContext
): { primary: PaletteAction; secondary: PaletteAction[] } {
    const canNew = context.canOpenNewPane();
    return {
        primary: {
            id: `chat:open:${threadId}`,
            label: 'Open',
            target: {
                kind: 'chat',
                threadId,
                destination: 'active',
            },
        },
        secondary: [
            {
                id: `chat:new-pane:${threadId}`,
                label: canNew ? 'Open in New Pane' : 'New pane unavailable',
                disabled: !canNew,
                disabledReason: canNew
                    ? undefined
                    : 'Pane capacity reached',
                target: {
                    kind: 'chat',
                    threadId,
                    destination: 'new-pane',
                },
            },
        ],
    };
}

export function documentActions(
    documentId: string,
    context: PaletteLoadContext
): { primary: PaletteAction; secondary: PaletteAction[] } {
    const canNew = context.canOpenNewPane();
    return {
        primary: {
            id: `document:open:${documentId}`,
            label: 'Open',
            target: {
                kind: 'document',
                documentId,
                destination: 'active',
            },
        },
        secondary: [
            {
                id: `document:new-pane:${documentId}`,
                label: canNew ? 'Open in New Pane' : 'New pane unavailable',
                disabled: !canNew,
                disabledReason: canNew
                    ? undefined
                    : 'Pane capacity reached',
                target: {
                    kind: 'document',
                    documentId,
                    destination: 'new-pane',
                },
            },
        ],
    };
}

export function paneAppActions(
    appId: string,
    recordId: string,
    context: PaletteLoadContext
): { primary: PaletteAction; secondary: PaletteAction[] } {
    const canNew = context.canOpenNewPane();
    return {
        primary: {
            id: `pane-app:open:${appId}:${recordId}`,
            label: 'Open',
            target: {
                kind: 'pane-app',
                appId,
                recordId,
                destination: 'active',
            },
        },
        secondary: [
            {
                id: `pane-app:new-pane:${appId}:${recordId}`,
                label: canNew ? 'Open in New Pane' : 'New pane unavailable',
                disabled: !canNew,
                disabledReason: canNew
                    ? undefined
                    : 'Pane capacity reached',
                target: {
                    kind: 'pane-app',
                    appId,
                    recordId,
                    destination: 'new-pane',
                },
            },
        ],
    };
}
