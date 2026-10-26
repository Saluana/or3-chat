import { measureWireValue } from './rpc-envelope';
export const TOOL_CARD_SNAPSHOT_BYTES = 160 * 1024;
export type CardAction = 'setState' | 'send' | 'openLink';
export type CardFrameMessage =
    | { type: 'ready' | 'mounted' }
    | { type: 'resize'; height: number }
    | {
          type: 'action';
          id: string;
          name: CardAction;
          payload: unknown;
          activated: boolean;
      }
    | { type: 'error'; code: string; message: string };
/** Pure shape checker is also serialized into the host-owned relay. No closure dependencies. */
export function cardFrameShape(value: unknown): value is CardFrameMessage {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const message = value as Record<string, unknown>;
    const keys = Object.keys(message).sort().join(',');
    if (message.type === 'ready' || message.type === 'mounted') return keys === 'type';
    if (message.type === 'resize')
        return (
            keys === 'height,type' &&
            typeof message.height === 'number' &&
            Number.isFinite(message.height) &&
            message.height >= 48 &&
            message.height <= 720
        );
    if (message.type === 'action')
        return (
            keys === 'activated,id,name,payload,type' &&
            typeof message.id === 'string' &&
            message.id.length > 0 &&
            message.id.length <= 128 &&
            ['setState', 'send', 'openLink'].includes(message.name as string) &&
            typeof message.activated === 'boolean' &&
            (message.name === 'setState' || typeof message.payload === 'string')
        );
    if (message.type === 'error')
        return (
            keys === 'code,message,type' &&
            typeof message.code === 'string' &&
            message.code.length <= 64 &&
            typeof message.message === 'string' &&
            message.message.length <= 1024
        );
    return false;
}
export function validateCardFrameMessage(value: unknown): value is CardFrameMessage {
    return (
        measureWireValue(value, {
            maxBytes: 64 * 1024,
            maxDepth: 32,
            maxNodes: 20000
        }).ok && cardFrameShape(value)
    );
}
export function createCardProtocolBudget() {
    let start = Date.now();
    let actions = 0;
    let resizes = 0;
    return {
        accept(message: CardFrameMessage) {
            const now = Date.now();
            if (now - start >= 1000) {
                start = now;
                actions = 0;
                resizes = 0;
            }
            return message.type === 'action'
                ? ++actions <= 20
                : message.type === 'resize'
                  ? ++resizes <= 30
                  : true;
        }
    };
}

export interface CardFrameSnapshot {
    tool: string;
    callId: string;
    messageId: string;
    runtime: 'frame';
    status: 'running' | 'complete' | 'error';
    args: unknown;
    result: unknown;
    error: string | null;
    state: unknown;
    theme: { mode: 'light' | 'dark'; tokens: Record<string, string> };
}
export function validateCardSnapshot(value: unknown): value is CardFrameSnapshot {
    if (
        !measureWireValue(value, {
            maxBytes: TOOL_CARD_SNAPSHOT_BYTES,
            maxDepth: 32,
            maxNodes: 20000
        }).ok ||
        !value ||
        typeof value !== 'object'
    )
        return false;
    const snapshot = value as Record<string, unknown>;
    if (
        Object.keys(snapshot).sort().join(',') !==
        'args,callId,error,messageId,result,runtime,state,status,theme,tool'
    )
        return false;
    const theme = snapshot.theme as Record<string, unknown> | null;
    return (
        snapshot.runtime === 'frame' &&
        ['running', 'complete', 'error'].includes(snapshot.status as string) &&
        ['tool', 'callId', 'messageId'].every(
            (key) =>
                typeof snapshot[key] === 'string' &&
                (snapshot[key] as string).length <= 256
        ) &&
        (snapshot.error === null || typeof snapshot.error === 'string') &&
        !!theme &&
        Object.keys(theme).sort().join(',') === 'mode,tokens' &&
        ['light', 'dark'].includes(theme.mode as string) &&
        !!theme.tokens &&
        typeof theme.tokens === 'object' &&
        !Array.isArray(theme.tokens) &&
        Object.entries(theme.tokens).every(
            ([key, token]) =>
                /^--[a-zA-Z0-9-]+$/.test(key) &&
                typeof token === 'string' &&
                token.length <= 2048
        )
    );
}
