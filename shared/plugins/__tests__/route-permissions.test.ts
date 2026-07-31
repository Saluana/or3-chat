import { describe, expect, it } from 'vitest';
import { resolvePluginRoutePermission } from '../route-permissions';

describe('resolvePluginRoutePermission', () => {
    it.each([
        ['GET', 'workspace.read'],
        ['HEAD', 'workspace.read'],
        ['POST', 'workspace.write'],
        ['PUT', 'workspace.write'],
        ['PATCH', 'workspace.write'],
        ['DELETE', 'workspace.write'],
    ] as const)('defaults %s to %s', (method, permission) => {
        expect(resolvePluginRoutePermission(method)).toBe(permission);
    });

    it('allows strengthening a read default to write', () => {
        expect(resolvePluginRoutePermission('GET', 'workspace.write')).toBe('workspace.write');
    });

    it('refuses to weaken a write default to read', () => {
        expect(resolvePluginRoutePermission('POST', 'workspace.read')).toBe('workspace.write');
        expect(resolvePluginRoutePermission('DELETE', 'workspace.read')).toBe('workspace.write');
    });

    it('ignores unknown override values', () => {
        expect(resolvePluginRoutePermission('GET', 'admin.super')).toBe('workspace.read');
    });
});
