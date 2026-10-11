import { registerServerTool } from '../../../server/utils/chat/tool-registry';

/** Included by Nitro only in the explicitly enabled development harness. */
export default defineNitroPlugin(() => {
    const counters = new Map<string, number>();
    for (const name of ['test_fail', 'test_write_once']) registerServerTool({ type: 'function', function: {
        name, description: 'Cloud reliability fixture', parameters: { type: 'object', properties: { value: { type: 'string' } },
            required: ['value'], additionalProperties: false },
    } }, async (args, context) => {
        await context.assertToolAuthorized?.();
        if (name === 'test_fail') throw new Error('deliberate Cloud fixture failure');
        const count = (counters.get(context.callId) ?? 0) + 1;
        counters.set(context.callId, count);
        return JSON.stringify({ count, value: args.value });
    }, { runtime: 'server' });
});
