import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isFeatureEnabled, isWorkflowFeatureEnabled, isMentionSourceEnabled } from '../../app/composables/useOr3Config';

const { runtimeConfigMock } = vi.hoisted(() => ({
    runtimeConfigMock: {
        public: {
            features: {
                workflows: {
                    enabled: true,
                    editor: true,
                    slashCommands: true,
                    execution: true,
                },
                documents: { enabled: true },
                backup: { enabled: true },
                mentions: {
                    enabled: true,
                    documents: true,
                    conversations: true,
                },
                dashboard: { enabled: true },
            },
        },
    },
}));

vi.mock('#imports', () => ({
    useRuntimeConfig: () => runtimeConfigMock,
}));

describe('Feature Gating Helpers', () => {
    beforeEach(() => {
        runtimeConfigMock.public.features.workflows.enabled = true;
        runtimeConfigMock.public.features.workflows.editor = true;
        runtimeConfigMock.public.features.workflows.slashCommands = true;
        runtimeConfigMock.public.features.workflows.execution = true;
        runtimeConfigMock.public.features.documents.enabled = true;
        runtimeConfigMock.public.features.backup.enabled = true;
        runtimeConfigMock.public.features.mentions.enabled = true;
        runtimeConfigMock.public.features.mentions.documents = true;
        runtimeConfigMock.public.features.mentions.conversations = true;
        runtimeConfigMock.public.features.dashboard.enabled = true;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('isFeatureEnabled', () => {
        it('returns true when feature is enabled', () => {
            expect(isFeatureEnabled('workflows')).toBe(true);
            expect(isFeatureEnabled('documents')).toBe(true);
        });

        it('returns false when feature is disabled', () => {
            runtimeConfigMock.public.features.workflows.enabled = false;
            expect(isFeatureEnabled('workflows')).toBe(false);
        });
    });

    describe('isWorkflowFeatureEnabled', () => {
        it('returns true when master and sub-feature are enabled', () => {
            expect(isWorkflowFeatureEnabled('editor')).toBe(true);
        });

        it('returns false when master is disabled', () => {
            runtimeConfigMock.public.features.workflows.enabled = false;
            expect(isWorkflowFeatureEnabled('editor')).toBe(false);
        });

        it('returns false when sub-feature is disabled', () => {
            runtimeConfigMock.public.features.workflows.editor = false;
            expect(isWorkflowFeatureEnabled('editor')).toBe(false);
        });
    });

    describe('isMentionSourceEnabled', () => {
        it('returns true when master and source are enabled', () => {
            expect(isMentionSourceEnabled('documents')).toBe(true);
        });

        it('returns false when master is disabled', () => {
            runtimeConfigMock.public.features.mentions.enabled = false;
            expect(isMentionSourceEnabled('documents')).toBe(false);
        });

        it('returns false when source is disabled', () => {
            runtimeConfigMock.public.features.mentions.documents = false;
            expect(isMentionSourceEnabled('documents')).toBe(false);
        });
    });
});
