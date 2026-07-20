/**
 * Compatibility helpers for @openrouter/sdk v1 breaking changes.
 *
 * v0.3 used flat chat/oauth request shapes and returned models.list as
 * `{ data }`. v1 nests chat under `chatRequest`, oauth under `requestBody`,
 * and returns a PageIterator of `{ result: { data } }`.
 *
 * or3-workflow-core@0.1.x still calls the flat chat.send API, so we patch
 * clients passed into that adapter.
 */

import type { OpenRouter } from '@openrouter/sdk';
import type { Model as SDKModel } from '@openrouter/sdk/models';
import type { ExchangeAuthCodeForAPIKeyRequest } from '@openrouter/sdk/models/operations';
import type { SendChatCompletionRequestRequest } from '@openrouter/sdk/models/operations';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null;
}

/** Convert flat chat.send args to the v1 `{ chatRequest }` shape when needed. */
export function wrapLegacyChatSendArgs(
    request: UnknownRecord
): SendChatCompletionRequestRequest {
    if ('chatRequest' in request) {
        return request as SendChatCompletionRequestRequest;
    }

    const {
        httpReferer,
        appTitle,
        appCategories,
        xOpenRouterMetadata,
        ...chatRequest
    } = request;

    return {
        ...(httpReferer !== undefined ? { httpReferer } : {}),
        ...(appTitle !== undefined ? { appTitle } : {}),
        ...(appCategories !== undefined ? { appCategories } : {}),
        ...(xOpenRouterMetadata !== undefined ? { xOpenRouterMetadata } : {}),
        chatRequest,
    } as SendChatCompletionRequestRequest;
}

/** Convert flat oauth exchange args to the v1 `{ requestBody }` shape. */
export function wrapLegacyOAuthExchangeArgs(
    request: UnknownRecord
): ExchangeAuthCodeForAPIKeyRequest {
    if ('requestBody' in request) {
        return request as ExchangeAuthCodeForAPIKeyRequest;
    }

    const { httpReferer, appTitle, appCategories, ...requestBody } = request;

    return {
        ...(httpReferer !== undefined ? { httpReferer } : {}),
        ...(appTitle !== undefined ? { appTitle } : {}),
        ...(appCategories !== undefined ? { appCategories } : {}),
        requestBody,
    } as ExchangeAuthCodeForAPIKeyRequest;
}

type ModelsListPage = {
    result?: {
        data?: SDKModel[];
    };
};

/**
 * Collect model rows from a v1 models.list PageIterator.
 * Omitting offset/limit still returns the full catalog on the first page,
 * but we iterate so pagination stays correct if defaults change.
 */
export async function collectModelsFromListPages(
    pages: AsyncIterable<ModelsListPage>
): Promise<SDKModel[]> {
    const models: SDKModel[] = [];
    for await (const page of pages) {
        const batch = page.result?.data;
        if (Array.isArray(batch)) models.push(...batch);
    }
    return models;
}

/**
 * Patch an OpenRouter client so flat `chat.send({ model, messages, ... })`
 * calls (used by or3-workflow-core) are rewritten to the v1 nested shape.
 */
export function patchOpenRouterClientForWorkflowCompat(
    client: OpenRouter
): OpenRouter {
    const chat = client.chat as OpenRouter['chat'] & {
        send: (...args: unknown[]) => unknown;
    };
    const originalSend = chat.send.bind(chat);

    chat.send = ((request: unknown, options?: unknown) =>
        originalSend(
            wrapLegacyChatSendArgs(
                isRecord(request) ? request : { value: request }
            ),
            options
        )) as typeof chat.send;

    return client;
}
