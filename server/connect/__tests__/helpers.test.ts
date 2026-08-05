import { describe, expect, it } from 'vitest';
import {
    createUserCode,
    normalizeConnectRuntimeMetadata,
    normalizeUserCode,
    parseConnectHost,
} from '../helpers';

describe('OR3 Connect device codes and host metadata', () => {
    it('creates readable high-entropy confirmation phrases', () => {
        const codes = new Set(Array.from({ length: 100 }, () => createUserCode()));
        expect(codes.size).toBe(100);
        for (const code of codes) {
            expect(code).toMatch(/^[A-Z]+-[A-Z]+-[A-Z]+-\d{3}$/);
        }
    });

    it('normalizes pasted phrases and bounds host metadata', () => {
        expect(normalizeUserCode(' bright moon / tree 042 ')).toBe(
            'BRIGHT-MOON-TREE-042'
        );
        const host = parseConnectHost({
            name: `  ${'a'.repeat(100)}  `,
            platform: 'darwin',
            architecture: 'arm64',
            internVersion: '1.2.3',
        });
        expect(host.name).toHaveLength(80);
        expect(host.platform).toBe('darwin');
    });

    it.each([
        ['openclaw', 'runs', '/or3/'],
        ['hermes', 'runs', '/'],
        ['intern', 'intern', '/'],
    ] as const)('accepts the %s runtime binding', (runtime, driver, basePath) => {
        expect(normalizeConnectRuntimeMetadata({ runtime, driver, basePath })).toEqual({
            runtime,
            driver,
            basePath,
        });
    });

    it('rejects mismatched runtime bindings before enrollment', () => {
        expect(
            normalizeConnectRuntimeMetadata({
                runtime: 'openclaw',
                driver: 'intern',
                basePath: '/',
            }),
        ).toBeNull();
        expect(() =>
            parseConnectHost({
                name: 'OpenClaw',
                platform: 'darwin',
                architecture: 'arm64',
                runtime: 'openclaw',
                runtimeVersion: '1.0.0',
                driver: 'runs',
                basePath: '/',
            }),
        ).toThrow(/runtime connection details are invalid/i);
    });

    it('requires the appropriate version field for each runtime', () => {
        expect(() =>
            parseConnectHost({
                name: 'Hermes',
                platform: 'darwin',
                architecture: 'arm64',
                runtime: 'hermes',
                driver: 'runs',
                basePath: '/',
            }),
        ).toThrow(/runtime version is required/i);
        expect(
            parseConnectHost({
                name: 'Hermes',
                platform: 'darwin',
                architecture: 'arm64',
                runtime: 'hermes',
                runtimeVersion: '0.20.0',
                driver: 'runs',
                basePath: '/',
            }),
        ).toMatchObject({ runtime: 'hermes', driver: 'runs', basePath: '/' });
    });
});
