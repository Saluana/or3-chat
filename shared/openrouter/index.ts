/**
 * OpenRouter SDK Adapter Layer
 *
 * Provides a consistent interface for interacting with the OpenRouter API
 * using the official @openrouter/sdk package.
 */

// Client factory and configuration
export {
    createOpenRouterClient,
    getRequestOptions,
    DEFAULT_HEADERS,
    type OpenRouterClientConfig,
} from './client';

// Error handling utilities
export {
    normalizeSDKError,
    type NormalizedError,
    type ErrorCode,
} from './errors';

// Type mapping utilities
export { sdkModelToLocal } from './types';

// SSE parsing (used for streaming)
export { parseOpenRouterSSE } from './parseOpenRouterSSE';
