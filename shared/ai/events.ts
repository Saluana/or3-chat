import type { RequestUsage } from '../chat/compaction';
import type { ToolCall } from './types';

export interface ProviderRequestUsage {
    prompt_tokens: number;
    completion_tokens: number;
    model?: string;
    response_id?: string;
    /** Credits charged for this request. */
    cost?: number;
    cached_tokens?: number;
    reasoning_tokens?: number;
}

/** Missing or malformed counters remain absent rather than becoming a zero measurement. */
export function normalizeProviderRequestUsage(value: unknown): ProviderRequestUsage | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const row = value as Record<string, unknown>;
    const validCounter = (counter: unknown): counter is number => typeof counter === 'number' && Number.isSafeInteger(counter) && counter >= 0;
    if (!validCounter(row.prompt_tokens) || !validCounter(row.completion_tokens)) return undefined;
    const detail = (group: string, field: string): unknown => {
        const value = row[group];
        return value && typeof value === 'object' ? (value as Record<string, unknown>)[field] : undefined;
    };
    // Already-normalized usage passes through again (the reducer re-reads it), so
    // the flat counters are accepted as well as OpenRouter's nested ones.
    const cached = row.cached_tokens ?? detail('prompt_tokens_details', 'cached_tokens');
    const reasoning = row.reasoning_tokens ?? detail('completion_tokens_details', 'reasoning_tokens');
    // Cost and detail counters are optional extras: a bad value is dropped, never an error.
    return { prompt_tokens: row.prompt_tokens, completion_tokens: row.completion_tokens,
        ...(typeof row.model === 'string' && row.model.trim() ? { model: row.model } : {}),
        ...(typeof row.response_id === 'string' && row.response_id.trim() ? { response_id: row.response_id } : {}),
        ...(typeof row.cost === 'number' && Number.isFinite(row.cost) && row.cost >= 0 ? { cost: row.cost } : {}),
        ...(validCounter(cached) ? { cached_tokens: cached } : {}),
        ...(validCounter(reasoning) ? { reasoning_tokens: reasoning } : {}) };
}

export type AiEvent =
    | { type: 'usage'; usage: ProviderRequestUsage; requestUsage?: RequestUsage }
    | { type: 'text'; text: string }
    | { type: 'image'; url: string; final?: boolean; index?: number }
    | { type: 'reasoning'; text: string }
    | {
          type: 'tool_call';
          tool_call: ToolCall;
      }
    | { type: 'done'; truncated?: true; refused?: true };
