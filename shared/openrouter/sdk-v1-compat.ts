/**
 * Compatibility helpers for @openrouter/sdk v1 breaking changes.
 *
 * v0.3 used flat chat/oauth request shapes and returned models.list as
 * `{ data }`. v1 nests chat under `chatRequest`, oauth under `requestBody`,
 * and returns a PageIterator of `{ result: { data } }`.
 *
 * These helpers remain in use by non-workflow paths (caption, OAuth exchange,
 * model listing). Workflow execution now flows through the provider-neutral
 * `OpenRouterModelGateway`, so the former `chat.send` monkey patch is gone.
 */

import type { Model as SDKModel } from '@openrouter/sdk/models';
import type { ExchangeAuthCodeForAPIKeyRequest } from '@openrouter/sdk/models/operations';
import type { SendChatCompletionRequestRequest } from '@openrouter/sdk/models/operations';

type UnknownRecord = Record<string, unknown>;

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
