import { backgroundClientToolDigest, backgroundClientToolTokenDigest } from '../background-client-tool-claim';
import { describe, expect, it } from 'vitest';
import { decideToolCall, toolCallFingerprint, type ToolLedgerEntry } from '../tool-ledger';

const call = { id: 'call-1', name: 'write', arguments: '{"b":2,"a":1}' };
const fingerprint = toolCallFingerprint(call.name, call.arguments);
const entry = (state: ToolLedgerEntry['state']): ToolLedgerEntry => ({
    callId: call.id, name: call.name, argumentFingerprint: fingerprint, state,
    result: state === 'completed' ? 'done' : undefined,
    error: state === 'failed' ? 'failed once' : undefined,
});

describe('tool call ledger decisions', () => {
    it('distinguishes new, pending, running, completed, failed, and conflicting replay', () => {
        expect(decideToolCall(undefined, call).action).toBe('execute');
        expect(decideToolCall(entry('pending'), call).action).toBe('execute');
        expect(decideToolCall(entry('running'), call).action).toBe('running');
        expect(decideToolCall(entry('completed'), call)).toMatchObject({ action: 'replay', result: 'done' });
        expect(decideToolCall(entry('failed'), call)).toMatchObject({ action: 'failed', error: 'failed once' });
        expect(decideToolCall(entry('completed'), { ...call, arguments: '{"a":9}' }).action).toBe('conflict');
    });

    it('rejects a completed call whose changed arguments collide under the legacy diagnostic hash', () => {
        const original = { id: 'collision', name: 'write', arguments: '{"value":"dnzas"}' };
        const completed: ToolLedgerEntry = {
            callId: original.id, name: original.name,
            argumentFingerprint: toolCallFingerprint(original.name, original.arguments),
            state: 'completed', result: 'wrote first value',
        };
        expect(decideToolCall(completed, { ...original, arguments: '{"value":"1nzqii4"}' }).action).toBe('conflict');
    });

    it('refuses replay of legacy receipts whose argument identity cannot be established', () => {
        expect(decideToolCall({ ...entry('completed'), argumentFingerprint: 'fnv1a32:205e9a81' }, call).action).toBe('conflict');
    });

    it('fingerprints semantically identical object arguments identically', () => {
        expect(toolCallFingerprint('write', '{"a":1,"b":2}')).toBe(fingerprint);
    });
});

describe('background client tool claim binding', () => {
    const identity = {
        jobId: 'job', userId: 'user', workspaceId: 'workspace', threadId: 'thread', messageId: 'message',
        call: { id: 'call', name: 'write', arguments: '{"path":"a"}',
            definition: { type: 'function', function: { name: 'write', parameters: { type: 'object' } } } },
    };
    it('binds actual arguments, definition and originating identity, without trusting a cached fingerprint', () => {
        const digest = backgroundClientToolDigest(identity);
        expect(digest).toMatch(/^[a-f0-9]{64}$/);
        for (const patch of [
            { userId: 'other' }, { jobId: 'other' }, { workspaceId: 'other' }, { threadId: 'other' }, { messageId: 'other' },
            { call: { ...identity.call, id: 'other' } },
            { call: { ...identity.call, arguments: '{"path":"b"}' } },
            { call: { ...identity.call, definition: { changed: true } } },
        ]) expect(backgroundClientToolDigest({ ...identity, ...patch })).not.toBe(digest);
        expect(backgroundClientToolDigest({ ...identity, call: { ...identity.call,
            definition: { function: { parameters: { type: 'object' }, name: 'write' }, type: 'function' } } })).toBe(digest);
    });
    it('rejects missing, malformed and legacy unbound tokens', () => {
        const digest = backgroundClientToolDigest(identity);
        expect(backgroundClientToolTokenDigest(`or3ct1.${digest}.00000000-0000-4000-8000-000000000000`)).toBe(digest);
        for (const token of ['', 'legacy-token', `or3ct1.${digest}.forged`])
            expect(backgroundClientToolTokenDigest(token)).toBeNull();
    });
});
