import { describe, it, expect } from 'vitest';
import { defineOr3Config, DEFAULT_OR3_CONFIG } from '../../utils/or3-config';

describe('defineOr3Config', () => {
    describe('default values', () => {
        it('applies all defaults when called with empty object', () => {
            const config = defineOr3Config({});
            expect(config).toEqual(DEFAULT_OR3_CONFIG);
        });

        it('applies defaults for site when not provided', () => {
            const config = defineOr3Config({});
            expect(config.site.name).toBe('OR3');
            expect(config.site.defaultTheme).toBe('blank');
        });

        it('applies defaults for features when not provided', () => {
            const config = defineOr3Config({});
            expect(config.features.workflows.enabled).toBe(true);
            expect(config.features.workflows.editor).toBe(true);
            expect(config.features.workflows.slashCommands).toBe(true);
            expect(config.features.workflows.execution).toBe(true);
            expect(config.features.mentions.enabled).toBe(true);
            expect(config.features.mentions.documents).toBe(true);
            expect(config.features.mentions.conversations).toBe(true);
        });

        it('applies defaults for limits when not provided', () => {
            const config = defineOr3Config({});
            expect(config.limits.maxFileSizeBytes).toBe(20 * 1024 * 1024);
            expect(config.limits.maxCloudFileSizeBytes).toBe(100 * 1024 * 1024);
            expect(config.limits.maxFilesPerMessage).toBe(10);
            expect(config.limits.localStorageQuotaMB).toBeNull();
        });
    });

    describe('partial overrides', () => {
        it('merges partial site config with defaults', () => {
            const config = defineOr3Config({
                site: { name: 'My App' },
            });
            expect(config.site.name).toBe('My App');
            expect(config.site.defaultTheme).toBe('blank'); // default preserved
        });

        it('merges partial features with defaults', () => {
            const config = defineOr3Config({
                features: {
                    workflows: { editor: false },
                },
            });
            expect(config.features.workflows.enabled).toBe(true); // default
            expect(config.features.workflows.editor).toBe(false); // overridden
            expect(config.features.workflows.slashCommands).toBe(true); // default
        });

        it('allows disabling specific mention sources', () => {
            const config = defineOr3Config({
                features: {
                    mentions: { documents: false },
                },
            });
            expect(config.features.mentions.enabled).toBe(true);
            expect(config.features.mentions.documents).toBe(false);
            expect(config.features.mentions.conversations).toBe(true);
        });

        it('allows overriding limits', () => {
            const config = defineOr3Config({
                limits: { maxFileSizeBytes: 50 * 1024 * 1024 },
            });
            expect(config.limits.maxFileSizeBytes).toBe(50 * 1024 * 1024);
            expect(config.limits.maxFilesPerMessage).toBe(10); // default preserved
        });
    });

    describe('validation errors', () => {
        it('throws on invalid site.name (empty string)', () => {
            expect(() =>
                defineOr3Config({ site: { name: '' } })
            ).toThrow();
        });

        it('throws on negative maxFilesPerMessage', () => {
            expect(() =>
                defineOr3Config({ limits: { maxFilesPerMessage: 0 } })
            ).toThrow();
        });

        it('throws on non-integer maxPanes', () => {
            expect(() =>
                defineOr3Config({ ui: { maxPanes: 3.5 } })
            ).toThrow();
        });
    });

    describe('type inference', () => {
        it('returns correctly typed ResolvedOr3Config', () => {
            const config = defineOr3Config({});
            // TypeScript compilation will fail if types are wrong
            const siteName: string = config.site.name;
            const workflowsEnabled: boolean = config.features.workflows.enabled;
            const maxFiles: number = config.limits.maxFilesPerMessage;
            expect(siteName).toBe('OR3');
            expect(workflowsEnabled).toBe(true);
            expect(maxFiles).toBe(10);
        });
    });

    describe('boundary conditions', () => {
        it('throws on maxPanes exceeding max (8)', () => {
            expect(() =>
                defineOr3Config({ ui: { maxPanes: 9 } })
            ).toThrow();
        });

        it('throws on defaultPaneCount below min (1)', () => {
            expect(() =>
                defineOr3Config({ ui: { defaultPaneCount: 0 } })
            ).toThrow();
        });

        it('throws on negative file size limits', () => {
            expect(() =>
                defineOr3Config({ limits: { maxFileSizeBytes: -100 } })
            ).toThrow();
        });

        it('accepts maxPanes at upper boundary (8)', () => {
            const config = defineOr3Config({ ui: { maxPanes: 8 } });
            expect(config.ui.maxPanes).toBe(8);
        });

        it('accepts defaultPaneCount at lower boundary (1)', () => {
            const config = defineOr3Config({ ui: { defaultPaneCount: 1 } });
            expect(config.ui.defaultPaneCount).toBe(1);
        });

        it('throws on localStorageQuotaMB as negative', () => {
            expect(() =>
                defineOr3Config({ limits: { localStorageQuotaMB: -10 } })
            ).toThrow();
        });

        it('accepts maxCloudFileSizeBytes at reasonable values', () => {
            const config = defineOr3Config({
                limits: { maxCloudFileSizeBytes: 500 * 1024 * 1024 },
            });
            expect(config.limits.maxCloudFileSizeBytes).toBe(500 * 1024 * 1024);
        });

        it('throws on zero maxFilesPerMessage', () => {
            expect(() =>
                defineOr3Config({ limits: { maxFilesPerMessage: 0 } })
            ).toThrow();
        });
    });

    describe('error messages', () => {
        it('produces readable error for validation failures', () => {
            try {
                defineOr3Config({ site: { name: '' } });
                expect.fail('should have thrown');
            } catch (err: any) {
                expect(err.message).toContain('[or3-config]');
                expect(err.message).toContain('site.name');
            }
        });

        it('lists multiple errors when multiple fields invalid', () => {
            try {
                defineOr3Config({
                    site: { name: '' },
                    limits: { maxFilesPerMessage: 0 },
                });
                expect.fail('should have thrown');
            } catch (err: any) {
                expect(err.message).toContain('site.name');
                expect(err.message).toContain('maxFilesPerMessage');
            }
        });

        it('includes path in error messages', () => {
            try {
                defineOr3Config({ ui: { maxPanes: 10 } });
                expect.fail('should have thrown');
            } catch (err: any) {
                expect(err.message).toContain('ui.maxPanes');
            }
        });
    });
});
