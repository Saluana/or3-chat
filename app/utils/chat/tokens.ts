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

/**
 * Approximate token count for a string. Returns 0 for empty input.
 */
export async function countTokensApprox(text: string): Promise<number> {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}
