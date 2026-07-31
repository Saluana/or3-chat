import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfigEntries, writeConfigEntries } from '../config-manager';
import { readEnvFile, writeEnvFile } from '../env-file';
import { buildOr3CloudConfigFromEnv, buildOr3ConfigFromEnv } from '../resolve-config';

vi.mock('../env-file', () => ({
    readEnvFile: vi.fn(),
    writeEnvFile: vi.fn(),
}));

vi.mock('../resolve-config', () => ({
    buildOr3ConfigFromEnv: vi.fn(),
    buildOr3CloudConfigFromEnv: vi.fn(),
}));

describe('config manager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('masks secret values in readConfigEntries', async () => {
        vi.mocked(readEnvFile).mockResolvedValue({
            lines: [],
            map: {
                OPENROUTER_API_KEY: 'secret',
                OR3_SITE_NAME: 'My Site',
            },
            path: '/tmp/.env',
        });

        const entries = await readConfigEntries();
        const secret = entries.find((entry) => entry.key === 'OPENROUTER_API_KEY');
        const siteName = entries.find((entry) => entry.key === 'OR3_SITE_NAME');

        expect(secret).toMatchObject({ masked: true, value: '******' });
        expect(siteName).toMatchObject({ masked: false, value: 'My Site' });
    });

    it('rejects non-whitelisted keys on write', async () => {
        vi.mocked(readEnvFile).mockResolvedValue({ lines: [], map: {}, path: '/tmp/.env' });

        await expect(
            writeConfigEntries([{ key: 'NOT_ALLOWED', value: 'nope' }])
        ).rejects.toThrow('Key not allowed');
    });

    it('writes allowed updates and skips masked placeholders', async () => {
        vi.mocked(readEnvFile).mockResolvedValue({
            lines: [],
            map: {
                OPENROUTER_API_KEY: 'secret',
                OR3_SITE_NAME: 'Old Name',
            },
            path: '/tmp/.env',
        });

        await writeConfigEntries([
            { key: 'OR3_SITE_NAME', value: 'New Name' },
            { key: 'OPENROUTER_API_KEY', value: '******' },
        ]);

        expect(buildOr3ConfigFromEnv).toHaveBeenCalled();
        expect(buildOr3CloudConfigFromEnv).toHaveBeenCalled();
        expect(writeEnvFile).toHaveBeenCalledWith({
            OR3_SITE_NAME: 'New Name',
        });
    });

    it('treats null updates as deletions during validation', async () => {
        vi.mocked(readEnvFile).mockResolvedValue({
            lines: [],
            map: {
                OR3_MAX_FILE_SIZE_BYTES: '123',
            },
            path: '/tmp/.env',
        });

        await writeConfigEntries([{ key: 'OR3_MAX_FILE_SIZE_BYTES', value: null }]);

        const validationEnv = vi.mocked(buildOr3ConfigFromEnv).mock.calls[0]?.[0] as Record<
            string,
            unknown
        >;
        expect(validationEnv.OR3_MAX_FILE_SIZE_BYTES).toBeUndefined();
        expect(writeEnvFile).toHaveBeenCalledWith({
            OR3_MAX_FILE_SIZE_BYTES: null,
        });
    });
});
