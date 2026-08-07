import { describe, expect, it } from 'vitest';
import {
    assertPublicDockerPreflight,
    shouldInstallWizardDependencies,
} from '../index';

describe('wizard deploy options', () => {
    it('never installs dependencies when only saving settings', () => {
        expect(
            shouldInstallWizardDependencies({
                skipDeploy: true,
                installDependencies: true,
            })
        ).toBe(false);
    });

    it('keeps dependency installation enabled for an actual deploy by default', () => {
        expect(shouldInstallWizardDependencies({ skipDeploy: false })).toBe(
            true
        );
        expect(
            shouldInstallWizardDependencies({
                skipDeploy: false,
                installDependencies: false,
            })
        ).toBe(false);
    });
});

describe('public Docker preflight', () => {
    const publicDocker = {
        deploymentTarget: 'docker' as const,
        dockerExposure: 'public' as const,
        publicDomain: 'chat.example.com',
    };

    it('fails before applying configuration when DNS is missing', async () => {
        await expect(
            assertPublicDockerPreflight(publicDocker, {
                lookupDomain: async () => {
                    throw new Error('not found');
                },
            })
        ).rejects.toThrow('DNS for chat.example.com does not resolve');
    });

    it('fails before deployment when Caddy ports are occupied', async () => {
        await expect(
            assertPublicDockerPreflight(publicDocker, {
                lookupDomain: async () => ({ address: '203.0.113.1' }),
                portInUse: async (port) => port === 443,
            })
        ).rejects.toThrow('Public port 443 is already in use');
    });
});
