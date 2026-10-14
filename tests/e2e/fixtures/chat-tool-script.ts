export type FixtureCall = { id: string; name: string; args: string };
export const fixtureCall = (id: string, name = 'test_echo', value: unknown = 'echo'): FixtureCall =>
    ({ id, name, args: JSON.stringify({ value }) });
export const sseFrame = (delta: unknown, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;

/** The fixture provider enforces the same call/result ordering as strict providers. */
export function toolHistoryError(messages: { role: string; tool_calls?: { id: string }[]; tool_call_id?: string }[]): string | undefined {
    const pending = new Set<string>();
    for (const message of messages) {
        if (message.role === 'tool') {
            if (!message.tool_call_id || !pending.delete(message.tool_call_id)) return 'Tool result does not match a pending call.';
        } else {
            if (pending.size) return 'Tool calls must have matching results before another message.';
            for (const call of message.tool_calls ?? []) {
                if (!call.id || pending.has(call.id)) return 'Tool-call identity is missing or duplicated.';
                pending.add(call.id);
            }
        }
    }
    return pending.size ? 'Tool calls must have matching results.' : undefined;
}

/** Provider data only: the real parser, registry and controller interpret it. */
export function toolResponse(calls: FixtureCall[]): string {
    return sseFrame({ tool_calls: calls.map((call, index) => ({
        index, id: call.id, type: 'function',
        function: { name: call.name, arguments: call.args.slice(0, 5) },
    })) }) + calls.map((call, index) => sseFrame({ tool_calls: [{
        index, function: { arguments: call.args.slice(5) },
    }] })).join('') + sseFrame({}, 'tool_calls') + 'data: [DONE]\n\n';
}

export const priorityCases: { name: string; rounds: FixtureCall[][]; executions: number; errors: number; pattern?: RegExp }[] = [
    { name: '1 successful tool', rounds: [[fixtureCall('success')]], executions: 1, errors: 0 },
    { name: '2 handler throws', rounds: [[fixtureCall('failure', 'test_fail')]], executions: 1, errors: 1, pattern: /deliberate fixture failure/ },
    { name: 'handler throws an empty error', rounds: [[fixtureCall('empty-error', 'test_fail', 'empty-error')]], executions: 1, errors: 1, pattern: /Tool execution failed/ },
    { name: 'handler throws an oversized error', rounds: [[fixtureCall('large-error', 'test_fail', 'large-error')]], executions: 1, errors: 1, pattern: /token=\[redacted\]/ },
    { name: '3 tool never responds', rounds: [[fixtureCall('timeout', 'test_slow')]], executions: 1, errors: 1, pattern: /timed out/ },
    { name: '4 invalid JSON', rounds: [[{ id: 'json', name: 'test_echo', args: '{invalid' }]], executions: 0, errors: 1, pattern: /JSON/i },
    { name: '5 wrong argument types', rounds: [[fixtureCall('types', 'test_write_once', 42)]], executions: 0, errors: 1, pattern: /string|validation/i },
    { name: '6 unknown tool', rounds: [[fixtureCall('unknown', 'test_unknown')]], executions: 0, errors: 1, pattern: /not advertised/ },
    { name: '7 disabled tool', rounds: [[fixtureCall('disabled', 'test_echo')]], executions: 0, errors: 1, pattern: /not advertised|disabled/ },
    { name: '8 two successful tools', rounds: [[fixtureCall('first'), fixtureCall('second', 'test_write_once')]], executions: 2, errors: 0 },
    { name: '9 one of two tools fails', rounds: [[fixtureCall('first'), fixtureCall('second', 'test_fail')]], executions: 2, errors: 1, pattern: /deliberate fixture failure/ },
    { name: '10 duplicate call ID', rounds: [[fixtureCall('duplicate', 'test_write_once')], [fixtureCall('duplicate', 'test_write_once')]], executions: 1, errors: 0 },
    { name: '11 conflicting call ID', rounds: [[fixtureCall('conflict', 'test_write_once', 'first')], [fixtureCall('conflict', 'test_write_once', 'different')]], executions: 1, errors: 1, pattern: /reused with different arguments/ },
];
