/**
 * @module app/utils/chat/tokens
 *
 * Purpose:
 * Lightweight, non-composable token approximation for chat messages.
 *
 * Constraints:
 * - Uses a character-based approximation and does not load a tokenizer bundle
 * - Exact counts depend on the upstream provider
 */

import type { ORMessage, ORContentPart } from '~/core/auth/openrouter-build';

/**
 * Approximate token count for a string. Returns 0 for empty input.
 */
export async function countTokensApprox(text: string): Promise<number> {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

/**
 * Extract a tokenizable string from an OpenRouter message.
 * Images and non-text parts are ignored for counting because their cost is
 * model-specific and not available from a generic tokenizer.
 */
export function messageToCountableText(message: ORMessage): string {
    const parts = Array.isArray(message.content) ? message.content : [];
    const textParts: string[] = [];
    for (const part of parts as ORContentPart[]) {
        if (part.type === 'text') textParts.push(part.text);
    }
    return textParts.join('\n');
}
