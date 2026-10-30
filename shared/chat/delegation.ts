/** Host-owned delegation uses a bounded wait and a slightly longer browser claim. */
export const DELEGATE_CHAT_TOOL = 'delegate_chat';
export const DELEGATE_CHAT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const DELEGATE_CHAT_CLAIM_MS = DELEGATE_CHAT_TIMEOUT_MS + 60_000;
