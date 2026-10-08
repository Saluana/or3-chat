import type { PluginResult } from './results';
export type ToolCardStatus = 'running' | 'complete' | 'error';
export type ToolCardRuntime = 'page' | 'frame';
export interface ToolCardTheme {
    readonly mode: 'light' | 'dark';
    readonly tokens: Readonly<Record<`--${string}`, string>>;
}
export interface ToolCardContext<A = unknown, R = unknown, S = unknown> {
    readonly tool: string;
    readonly callId: string;
    readonly messageId: string;
    readonly runtime: ToolCardRuntime;
    readonly status: ToolCardStatus;
    readonly args: A | null;
    readonly result: R | null;
    readonly error: string | null;
    readonly state: S | null;
    readonly theme: ToolCardTheme;
    readonly signal: AbortSignal;
    setState(next: S): Promise<PluginResult<void>>;
    send(text: string): Promise<PluginResult<void>>;
    openLink(url: string): Promise<PluginResult<void>>;
    onUpdate(listener: (card: ToolCardContext<A, R, S>) => void): () => void;
}
export interface ToolCardModule<A = unknown, R = unknown, S = unknown> {
    mount(el: HTMLElement, card: ToolCardContext<A, R, S>): void | (() => void);
    readonly component?: unknown;
}
export interface ToolCardPresentation {
    readonly label?: string;
    readonly placement?: 'inline' | 'end';
    readonly renderWhile?: 'complete' | 'always';
    readonly chrome?: 'card' | 'none';
    readonly minHeight?: number;
}
export interface PluginToolCardDefinition extends ToolCardPresentation {
    readonly tool: string;
    readonly card: ToolCardModule;
}
export function defineToolCard<A = unknown, R = unknown, S = unknown>(
    module: ToolCardModule<A, R, S>
): ToolCardModule<A, R, S> {
    return module;
}
export function escapeHtml(value: unknown): string {
    return String(value).replace(
        /[&<>"']/g,
        (character) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            })[character]!
    );
}
/** A detached snapshot for framework helpers; actions keep their original closures. */
export function toolCardSnapshot<A, R, S>(
    card: ToolCardContext<A, R, S>
): ToolCardContext<A, R, S> {
    return Object.freeze({
        tool: card.tool,
        callId: card.callId,
        messageId: card.messageId,
        runtime: card.runtime,
        status: card.status,
        args: card.args,
        result: card.result,
        error: card.error,
        state: card.state,
        theme: card.theme,
        signal: card.signal,
        setState: card.setState,
        send: card.send,
        openLink: card.openLink,
        onUpdate: card.onUpdate
    });
}

export { createToolCardHarness } from './cards-testing';
