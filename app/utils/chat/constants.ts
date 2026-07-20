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
