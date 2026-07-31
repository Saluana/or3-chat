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

    it('fingerprints semantically identical object arguments identically', () => {
        expect(toolCallFingerprint('write', '{"a":1,"b":2}')).toBe(fingerprint);
    });
});
