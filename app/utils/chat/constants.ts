/**
 * @module app/utils/chat/constants
 *
 * Purpose:
 * Shared constants for the chat subsystem used by both client and server paths.
 */

/** Maximum number of back-to-back tool turns before forcing termination. */
export const MAX_TOOL_ITERATIONS = 10;

/** Conservative default input-token budget for chat context trimming. */
export const DEFAULT_MAX_INPUT_TOKENS = 8000;

/** Minimum useful input budget retained for small-context or unknown models. */
export const MIN_CHAT_INPUT_TOKENS = 1024;

/** Maximum response allowance reserved inside a model's context window. */
export const MAX_CHAT_OUTPUT_RESERVE_TOKENS = 8192;
