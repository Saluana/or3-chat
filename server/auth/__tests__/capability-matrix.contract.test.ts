import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REQUIRED_SURFACES = [
    'users.getAuthAccountByProvider',
    'workspaces.consumeInvite',
    'sync.push',
    'sync.runScheduledGc',
    'storage.commitUpload',
    'storage.gcDeletedFiles',
    'backgroundJobs.create',
    'backgroundJobs.abort',
    'notifications.create',
    'admin.ensureDeploymentAdmin',
    'admin.removeWorkspaceMember',
    'webhooks.createWebhook',
    'webhooks.claimPendingDeliveries',
    'rateLimits.checkAndRecord',
    'Foreground request with managed key',
    'Background server tool',
] as const;

describe('cloud capability matrix', () => {
    it('tracks every operation family and its authority dimensions', () => {
        const path = resolve(
            process.cwd(),
            'public/_documentation/cloud/capability-matrix.md'
        );
        const matrix = readFileSync(path, 'utf8');

        for (const surface of REQUIRED_SURFACES) {
            expect(matrix, `missing capability entry for ${surface}`).toContain(
                surface
            );
        }
        expect(matrix).toContain('Subject source');
        expect(matrix).toContain('Resource scope');
        expect(matrix).toContain('Capability');
        expect(matrix).toContain('Allowed role');
        expect(matrix).toContain('never establish the acting user');
    });
});
