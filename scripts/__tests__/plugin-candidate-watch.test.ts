import { describe, expect, it } from 'vitest';
import { pluginBuildEnvironment } from '../cli/plugin-candidate-watch';

describe('plugin authoring subprocess', () => {
    it('does not inherit local host credentials or provider selection', () => {
        const env = pluginBuildEnvironment({
            PATH: '/usr/bin', CI: '1', BUN_INSTALL: '/bun',
            OR3_ADMIN_PASSWORD: 'local-password',
            OR3_BASIC_AUTH_JWT_SECRET: 'local-jwt',
            OR3_STORAGE_FS_TOKEN_SECRET: 'local-storage',
            NUXT_PUBLIC_STORAGE_PROVIDER: 'fs',
            DOTENV_CONFIG_PATH: '/host/empty.env',
        });
        expect(env).toEqual({ PATH: '/usr/bin', CI: '1', BUN_INSTALL: '/bun' });
    });
});
