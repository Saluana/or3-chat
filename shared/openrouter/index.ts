/**
 * OpenRouter SDK Adapter Layer
 *
 * Provides a consistent interface for interacting with the OpenRouter API
 * using the official @openrouter/sdk package.
 */

// Client factory and configuration
export {
    createOpenRouterClient,
    type OpenRouterClientConfig,
} from './client';
export { getRequestOptions, DEFAULT_HEADERS } from './request-options';

// Error handling utilities
export {
    normalizeSDKError,
    OpenRouterStreamError,
    OpenRouterProtocolError,
    OpenRouterProviderError,
    type NormalizedError,
    type ErrorCode,
    type OpenRouterStreamFailureKind,
} from './errors';

// Type mapping utilities
export { sdkModelToLocal, type OpenRouterModel } from './types';

// SDK v1 compatibility helpers (non-workflow: caption, OAuth, model listing)
export {
    collectModelsFromListPages,
    fetchOpenRouterCatalog,
    wrapLegacyChatSendArgs,
    wrapLegacyOAuthExchangeArgs,
} from './sdk-v1-compat';

// SSE parsing (used for streaming)
export {
    parseOpenRouterSSE,
    type ParseOpenRouterSSEOptions,
    type StreamedFieldMode,
} from './parseOpenRouterSSE';
