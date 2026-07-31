/**
 * @module app/utils/chat/constants
 *
 * Purpose:
 * Shared constants for the chat subsystem used by both client and server paths.
 */

/** Maximum number of back-to-back tool turns before forcing termination. */
export const MAX_TOOL_ITERATIONS = 10;

/** Default cap for image inputs included in a single chat request context. */
export const MAX_CHAT_IMAGE_INPUTS = 5;

/** Conservative default input-token budget for chat context trimming. */
export const DEFAULT_MAX_INPUT_TOKENS = 8000;

/** Minimum useful input budget retained for small-context or unknown models. */
export const MIN_CHAT_INPUT_TOKENS = 1024;

/**
 * Browser-side safety cap. Very large provider windows remain usable without
 * allowing a single request to monopolize memory while building its payload.
 */
export const MAX_CHAT_INPUT_TOKENS = 128_000;

/** Maximum response allowance reserved inside a model's context window. */
export const MAX_CHAT_OUTPUT_RESERVE_TOKENS = 8192;
