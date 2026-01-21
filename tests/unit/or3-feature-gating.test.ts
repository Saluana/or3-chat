import { describe, it, expect, vi, afterEach } from 'vitest';
import { isFeatureEnabled, isWorkflowFeatureEnabled, isMentionSourceEnabled } from '../../app/composables/useOr3Config';
import { or3Config } from '../../config.or3';

// Mock the config module
vi.mock('../../config.or3', () => ({
    or3Config: {
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
}));

describe('Feature Gating Helpers', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('isFeatureEnabled', () => {
        it('returns true when feature is enabled', () => {
            expect(isFeatureEnabled('workflows')).toBe(true);
            expect(isFeatureEnabled('documents')).toBe(true);
        });

        it('returns false when feature is disabled', () => {
            // Temporarily modify the mock for this test
            or3Config.features.workflows.enabled = false;
            expect(isFeatureEnabled('workflows')).toBe(false);
            // Reset
            or3Config.features.workflows.enabled = true;
        });
    });

    describe('isWorkflowFeatureEnabled', () => {
        it('returns true when master and sub-feature are enabled', () => {
            expect(isWorkflowFeatureEnabled('editor')).toBe(true);
        });

        it('returns false when master is disabled', () => {
            or3Config.features.workflows.enabled = false;
            expect(isWorkflowFeatureEnabled('editor')).toBe(false);
            or3Config.features.workflows.enabled = true;
        });

        it('returns false when sub-feature is disabled', () => {
            or3Config.features.workflows.editor = false;
            expect(isWorkflowFeatureEnabled('editor')).toBe(false);
            or3Config.features.workflows.editor = true;
        });
    });

    describe('isMentionSourceEnabled', () => {
        it('returns true when master and source are enabled', () => {
            expect(isMentionSourceEnabled('documents')).toBe(true);
        });

        it('returns false when master is disabled', () => {
            or3Config.features.mentions.enabled = false;
            expect(isMentionSourceEnabled('documents')).toBe(false);
            or3Config.features.mentions.enabled = true;
        });

        it('returns false when source is disabled', () => {
            or3Config.features.mentions.documents = false;
            expect(isMentionSourceEnabled('documents')).toBe(false);
            or3Config.features.mentions.documents = true;
        });
    });
});
