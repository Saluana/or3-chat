import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('#imports', () => ({ useRuntimeConfig: vi.fn() }));

import { isAdminEnabled } from '../is-admin-enabled';

let directory: string;

describe('persisted admin enablement', () => {
    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'or3-admin-enabled-'));
        vi.stubEnv('OR3_ADMIN_DATA_DIR', directory);
        vi.stubEnv('OR3_ADMIN_USERNAME', '');
        vi.stubEnv('OR3_ADMIN_PASSWORD', '');
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await rm(directory, { recursive: true, force: true });
    });

    it('stays enabled from the protected credential file after provisioning env is removed', async () => {
        expect(isAdminEnabled()).toBe(false);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, 'admin-credentials.json'), '{}', { mode: 0o600 });
        expect(isAdminEnabled()).toBe(true);
    });
});
