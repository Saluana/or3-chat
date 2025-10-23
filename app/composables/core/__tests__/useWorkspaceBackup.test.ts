import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLazyBoundaries } from '../useLazyBoundaries';

describe('useWorkspaceBackup lazy loaders', () => {
    beforeEach(() => {
        const boundaries = useLazyBoundaries();
        boundaries.reset('workspace-export');
        boundaries.reset('workspace-import');
    });

    describe('loadStreamSaver (workspace-export)', () => {
        it('should load streamsaver module via lazy boundary', async () => {
            const boundaries = useLazyBoundaries();

            const mockModule = {
                createWriteStream: vi.fn(),
                mitm: '',
            };

            const result = await boundaries.load({
                key: 'workspace-export',
                loader: async () => mockModule as any,
            });

            expect(result).toBe(mockModule);
            expect(boundaries.getState('workspace-export')).toBe('ready');
        });

        it('should cache streamsaver module across calls', async () => {
            const boundaries = useLazyBoundaries();
            const loader = vi.fn().mockResolvedValue({ default: {} });

            const result1 = await boundaries.load({
                key: 'workspace-export',
                loader,
            });

            const result2 = await boundaries.load({
                key: 'workspace-export',
                loader,
            });

            expect(result1).toBe(result2);
            expect(loader).toHaveBeenCalledTimes(1);
        });

        it('should handle streamsaver load failure', async () => {
            const boundaries = useLazyBoundaries();

            const loader = vi
                .fn()
                .mockRejectedValue(new Error('Network error'));

            await expect(
                boundaries.load({
                    key: 'workspace-export',
                    loader,
                })
            ).rejects.toThrow('Network error');

            expect(boundaries.getState('workspace-export')).toBe('error');
        });

        it('should allow retry after reset on failure', async () => {
            const boundaries = useLazyBoundaries();

            const failingLoader = vi
                .fn()
                .mockRejectedValue(new Error('First fail'));
            const successLoader = vi.fn().mockResolvedValue({ default: {} });

            // First attempt fails
            await expect(
                boundaries.load({
                    key: 'workspace-export',
                    loader: failingLoader,
                })
            ).rejects.toThrow();

            // Reset boundary
            boundaries.reset('workspace-export');

            // Second attempt succeeds
            const result = await boundaries.load({
                key: 'workspace-export',
                loader: successLoader,
            });

            expect(result).toEqual({ default: {} });
            expect(boundaries.getState('workspace-export')).toBe('ready');
        });
    });

    describe('loadDexieExportImport (workspace-import)', () => {
        it('should load dexie-export-import module via lazy boundary', async () => {
            const boundaries = useLazyBoundaries();

            const mockModule = {
                importInto: vi.fn(),
                exportDB: vi.fn(),
                peakImportFile: vi.fn(),
            };

            const result = await boundaries.load({
                key: 'workspace-import',
                loader: async () => mockModule as any,
            });

            expect(result).toBe(mockModule);
            expect(boundaries.getState('workspace-import')).toBe('ready');
        });

        it('should cache dexie-export-import across calls', async () => {
            const boundaries = useLazyBoundaries();
            const loader = vi.fn().mockResolvedValue({
                importInto: vi.fn(),
            });

            await boundaries.load({
                key: 'workspace-import',
                loader,
            });

            await boundaries.load({
                key: 'workspace-import',
                loader,
            });

            expect(loader).toHaveBeenCalledTimes(1);
        });

        it('should handle import module load failure', async () => {
            const boundaries = useLazyBoundaries();

            await expect(
                boundaries.load({
                    key: 'workspace-import',
                    loader: async () => {
                        throw new Error('Module not found');
                    },
                })
            ).rejects.toThrow('Module not found');

            expect(boundaries.getState('workspace-import')).toBe('error');
        });
    });

    describe('lazy loading timing', () => {
        it('should complete module load and track state', async () => {
            const boundaries = useLazyBoundaries();

            const mockModule = { default: {} };
            const startTime = Date.now();

            await boundaries.load({
                key: 'workspace-export',
                loader: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 100));
                    return mockModule;
                },
            });

            const duration = Date.now() - startTime;
            expect(duration).toBeGreaterThanOrEqual(90);
            expect(boundaries.getState('workspace-export')).toBe('ready');
        });

        it('should track error state on load failure', async () => {
            const boundaries = useLazyBoundaries();

            try {
                await boundaries.load({
                    key: 'workspace-import',
                    loader: async () => {
                        throw new Error('Load failed');
                    },
                });
            } catch {
                // Expected
            }

            expect(boundaries.getState('workspace-import')).toBe('error');
        });
    });
});
