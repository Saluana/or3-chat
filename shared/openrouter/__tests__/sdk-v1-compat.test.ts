import { describe, expect, it } from 'vitest';
import {
    collectModelsFromListPages,
    wrapLegacyChatSendArgs,
    wrapLegacyOAuthExchangeArgs,
} from '../sdk-v1-compat';
import { sdkModelToLocal } from '../types';
import { normalizeSDKError } from '../errors';

describe('openrouter sdk v1 compat helpers', () => {
    it('wraps flat chat.send args into chatRequest', () => {
        expect(
            wrapLegacyChatSendArgs({
                model: 'openai/gpt-4',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
                maxTokens: 100,
            })
        ).toEqual({
            chatRequest: {
                model: 'openai/gpt-4',
                messages: [{ role: 'user', content: 'hi' }],
                stream: false,
                maxTokens: 100,
            },
        });
    });

    it('leaves already-nested chatRequest args alone', () => {
        const nested = {
            chatRequest: {
                model: 'openai/gpt-4',
                messages: [{ role: 'user', content: 'hi' }],
            },
            appTitle: 'or3.chat',
        };
        expect(wrapLegacyChatSendArgs(nested)).toEqual(nested);
    });

    it('wraps oauth exchange args into requestBody', () => {
        expect(
            wrapLegacyOAuthExchangeArgs({
                code: 'abc',
                codeVerifier: 'verifier',
                codeChallengeMethod: 'S256',
            })
        ).toEqual({
            requestBody: {
                code: 'abc',
                codeVerifier: 'verifier',
                codeChallengeMethod: 'S256',
            },
        });
    });

    it('collects models across paginated list pages', async () => {
        const page = {
            result: {
                data: [{ id: 'a' }, { id: 'b' }],
            },
            async *[Symbol.asyncIterator]() {
                yield this;
                yield {
                    result: {
                        data: [{ id: 'c' }],
                    },
                };
            },
        };

        await expect(collectModelsFromListPages(page as never)).resolves.toEqual(
            [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
        );
    });

    it('maps SDK model reasoning from camelCase to local snake_case', () => {
        const local = sdkModelToLocal({
            id: 'test/model',
            name: 'Test',
            created: 1,
            canonicalSlug: 'test/model',
            contextLength: 8192,
            description: 'desc',
            huggingFaceId: null,
            defaultParameters: null,
            perRequestLimits: null,
            supportedVoices: null,
            links: { details: '/api/v1/models/test/model' },
            architecture: {
                inputModalities: ['text'],
                outputModalities: ['text'],
                modality: 'text->text',
                tokenizer: undefined,
                instructType: null,
            },
            topProvider: {
                isModerated: false,
                contextLength: 8192,
                maxCompletionTokens: 1024,
            },
            pricing: {
                prompt: '0.001',
                completion: '0.002',
            },
            supportedParameters: ['temperature', 'reasoning'],
            reasoning: {
                mandatory: false,
                defaultEnabled: true,
                defaultEffort: 'medium',
                supportedEfforts: ['low', 'medium', 'high'],
                supportsMaxTokens: true,
            },
        } as never);

        expect(local.reasoning).toEqual({
            mandatory: false,
            default_enabled: true,
            default_effort: 'medium',
            supported_efforts: ['low', 'medium', 'high'],
            supports_max_tokens: true,
        });
    });

    it('normalizeSDKError still handles unknown errors without ChatError', () => {
        const normalized = normalizeSDKError(new Error('boom'));
        expect(normalized.code).toBe('ERR_UNKNOWN');
        expect(normalized.message).toBe('boom');
    });
});
