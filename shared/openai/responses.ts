import type { AiEvent } from '../ai/events';
import { MAX_SSE_EVENT_BYTES, MAX_TOOL_ARGUMENT_BYTES, utf8Bytes } from '../chat/tool-limits';
import { OpenRouterProtocolError, OpenRouterProviderError } from '../openrouter/errors';
import { openAiApiModel } from './models';

type ResponsesStreamEvent = {
    type?: string;
    delta?: string;
    message?: string;
    error?: { message?: string };
    response?: {
        error?: { message?: string };
        output?: Record<string, unknown>[];
        usage?: {
            input_tokens?: number;
            output_tokens?: number;
            input_tokens_details?: { cached_tokens?: number };
            output_tokens_details?: { reasoning_tokens?: number };
        };
        model?: string;
        id?: string;
    };
};

/** Project the admitted chat history onto Responses items without storing it at OpenAI. */
export function encodeOpenAiResponseRequest(body: Record<string, unknown>): Record<string, unknown> {
    const messages = Array.isArray(body.messages) ? body.messages as Record<string, unknown>[] : [];
    const input: Record<string, unknown>[] = [];
    for (const message of messages) {
        if (message.role === 'tool') {
            const content = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
                ? message.content.map(part => typeof part?.text === 'string' ? part.text : '').join('') : '';
            input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: content });
            continue;
        }
        if (Array.isArray(message._openai_reasoning)) input.push(...message._openai_reasoning as Record<string, unknown>[]);
        const content = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
            ? message.content.flatMap<Record<string, unknown>>(part => {
                if (part.type === 'text') return [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text }];
                if (part.type === 'image_url') return [{ type: 'input_image', image_url: typeof part.image_url === 'string' ? part.image_url : part.image_url?.url, detail: part.image_url?.detail ?? 'auto' }];
                if (part.type === 'file') return [{ type: 'input_file', filename: part.file?.filename, file_data: part.file?.file_data }];
                throw new Error('Unsupported content type in OpenAI request');
            }) : '';
        if (content.length) input.push({ role: message.role, content });
        if (Array.isArray(message.tool_calls)) for (const call of message.tool_calls) {
            if (call?.type === 'function') input.push({ type: 'function_call', call_id: call.id, name: call.function?.name, arguments: call.function?.arguments });
        }
    }
    const tools = Array.isArray(body.tools) ? body.tools.flatMap(tool => {
        const fn = (tool as { type?: string; function?: Record<string, unknown> }).function;
        return (tool as { type?: string }).type === 'function' && fn ? [{ type: 'function', ...fn, strict: fn.strict ?? false }] : [];
    }) : [];
    const effort = body.reasoning_effort;
    const format = body.response_format as { type?: string; json_schema?: Record<string, unknown> } | undefined;
    const textFormat = format?.type === 'json_schema' && format.json_schema
        ? { type: 'json_schema', ...format.json_schema }
        : format?.type === 'json_object' || format?.type === 'text' ? { type: format.type } : undefined;
    const choice = body.tool_choice as string | { type?: string; function?: { name?: string } } | undefined;
    return { model: openAiApiModel(String(body.model)), input, stream: body.stream === true, store: false,
        include: ['reasoning.encrypted_content'],
        ...(typeof body.max_tokens === 'number' ? { max_output_tokens: body.max_tokens } : {}),
        ...(typeof body.max_completion_tokens === 'number' ? { max_output_tokens: body.max_completion_tokens } : {}),
        ...(typeof effort === 'string' ? { reasoning: { effort } } : {}),
        ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
        ...(typeof body.top_p === 'number' ? { top_p: body.top_p } : {}),
        ...(textFormat ? { text: { format: textFormat } } : {}),
        ...(tools.length ? { tools, ...(choice ? { tool_choice: typeof choice === 'string' ? choice : { type: 'function', name: choice.function?.name } } : {}) } : {}),
        ...(typeof body.parallel_tool_calls === 'boolean' ? { parallel_tool_calls: body.parallel_tool_calls } : {}) };
}

/** Convert Responses SSE to OR3 events; incomplete streams never count as success. */
export async function* decodeOpenAiResponseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<AiEvent> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let refused = false;
    let sourceDone = false;
    try {
        for (;;) {
            const chunk = await reader.read();
            sourceDone = chunk.done;
            // A CR at the end of a network chunk may be the first half of CRLF.
            buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            buffer = buffer.replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n');
            if (chunk.done && buffer.endsWith('\r')) buffer = `${buffer.slice(0, -1)}\n`;
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
                if (utf8Bytes(frame) > MAX_SSE_EVENT_BYTES) throw new OpenRouterProtocolError('OpenAI response event exceeds the size limit');
                const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
                if (!data || data === '[DONE]') continue;
                let parsed: unknown;
                try { parsed = JSON.parse(data) as unknown; } catch { throw new OpenRouterProtocolError('Malformed OpenAI response event'); }
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new OpenRouterProtocolError('Invalid OpenAI response event');
                const event = parsed as ResponsesStreamEvent;
                if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') yield { type: 'text', text: event.delta };
                if (event.type === 'response.refusal.delta' && typeof event.delta === 'string') {
                    refused = true;
                    yield { type: 'text', text: event.delta };
                }
                if (event.type === 'response.reasoning_summary_text.delta' && typeof event.delta === 'string') yield { type: 'reasoning', text: event.delta };
                if (event.type === 'error' || event.type === 'response.failed') throw new OpenRouterProviderError(
                    (typeof event.message === 'string' ? event.message : undefined) ?? event.error?.message ?? event.response?.error?.message ?? 'OpenAI response failed');
                if (event.type !== 'response.completed' && event.type !== 'response.incomplete') continue;
                const response = event.response ?? {};
                const output = Array.isArray(response.output) ? response.output : [];
                const reasoning = output.filter((item: Record<string, unknown>) => item.type === 'reasoning' && typeof item.encrypted_content === 'string');
                if (reasoning.length) yield { type: 'provider_state', items: reasoning };
                for (const item of output) if (event.type === 'response.completed' && item.type === 'function_call') {
                    if (typeof item.call_id !== 'string' || !item.call_id.trim() || typeof item.name !== 'string' || !item.name.trim()
                        || typeof item.arguments !== 'string' || utf8Bytes(item.arguments) > MAX_TOOL_ARGUMENT_BYTES)
                        throw new OpenRouterProtocolError('Invalid OpenAI function call');
                    yield { type: 'tool_call', tool_call: { id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } } };
                }
                const usage = response.usage;
                if (typeof usage?.input_tokens === 'number' && Number.isSafeInteger(usage.input_tokens)
                    && typeof usage.output_tokens === 'number' && Number.isSafeInteger(usage.output_tokens)) yield { type: 'usage', usage: {
                    prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, model: response.model, response_id: response.id,
                    ...(typeof usage.input_tokens_details?.cached_tokens === 'number' ? { cached_tokens: usage.input_tokens_details.cached_tokens } : {}),
                    ...(typeof usage.output_tokens_details?.reasoning_tokens === 'number' ? { reasoning_tokens: usage.output_tokens_details.reasoning_tokens } : {}) } };
                yield { type: 'done', ...(event.type === 'response.incomplete' ? { truncated: true as const } : {}), ...(refused ? { refused: true as const } : {}) };
                return;
            }
            if (utf8Bytes(buffer) > MAX_SSE_EVENT_BYTES) throw new OpenRouterProtocolError('OpenAI response event exceeds the size limit');
            if (chunk.done) break;
        }
        throw new OpenRouterProtocolError('OpenAI response ended before completion');
    } finally {
        if (!sourceDone) await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
