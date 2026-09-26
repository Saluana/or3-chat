import { Extension } from '@tiptap/core';

export interface TrustedEditorExtensionInput {
    readonly id: string;
    readonly extension: Extension;
    readonly suggestion?: { readonly char: string };
    readonly onSlashCommand?: (command: string) => boolean | Promise<boolean>;
}

interface RegisteredEditorExtension extends TrustedEditorExtensionInput {
    readonly owner: symbol;
}

const registry = new Map<string, RegisteredEditorExtension>();

export function registerTrustedEditorExtension(
    input: TrustedEditorExtensionInput
): { dispose(): void } {
    const owner = Symbol(input.id);
    registry.set(input.id, { ...input, owner });
    return {
        dispose() {
            const current = registry.get(input.id);
            if (current?.owner === owner) registry.delete(input.id);
        },
    };
}

/** Same filter the chat editor applies to `ui.chat.editor:filter:extensions`. */
export function applyTrustedEditorExtensions(existing: readonly object[]): object[] {
    return [...existing, ...[...registry.values()].map((entry) => entry.extension)];
}

/** Intercepts a send when the text starts with a registered suggestion character. */
export async function interceptTrustedEditorSend(text: string): Promise<boolean> {
    const trimmed = text.trim();
    for (const entry of registry.values()) {
        const trigger = entry.suggestion?.char;
        if (!trigger || !trimmed.startsWith(trigger) || !entry.onSlashCommand) continue;
        const command = trimmed.slice(trigger.length).trim();
        if (await entry.onSlashCommand(command)) return true;
    }
    return false;
}

export function slashFixtureExtension(name = 'slash-fixture'): Extension {
    return Extension.create({ name });
}
