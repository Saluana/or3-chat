/* @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { validateWebhookUrl } from '../url-validator';

const publicResolver = async () => [{ address: '8.8.8.8', family: 4 }];
const privateResolver = async () => [{ address: '10.0.0.9', family: 4 }];

describe('validateWebhookUrl', () => {
    it('accepts a valid HTTPS URL', async () => {
        const parsed = await validateWebhookUrl('https://example.com/hooks', {
            resolver: publicResolver,
        });

        expect(parsed.toString()).toBe('https://example.com/hooks');
    });

    it('accepts HTTP when HTTPS is not required', async () => {
        const parsed = await validateWebhookUrl('http://example.com/hooks', {
            resolver: publicResolver,
        });

        expect(parsed.toString()).toBe('http://example.com/hooks');
    });

    it('rejects HTTP when HTTPS is required', async () => {
        await expect(
            validateWebhookUrl('http://example.com/hooks', {
                requireHttps: true,
            })
        ).rejects.toThrow(/must use https/i);
    });

    it('rejects invalid URLs', async () => {
        await expect(validateWebhookUrl('not a url')).rejects.toThrow(
            /invalid webhook url/i
        );
    });

    it('rejects non-http protocols', async () => {
        await expect(
            validateWebhookUrl('ftp://example.com/hooks')
        ).rejects.toThrow(/must use http or https/i);
    });

    it.each([
        'https://user@example.com/hooks',
        'https://user:secret@example.com/hooks',
    ])('rejects embedded URL credentials: %s', async (url) => {
        await expect(validateWebhookUrl(url)).rejects.toThrow(
            /credentials/i
        );
    });

    it.each([
        'http://127.0.0.1/hooks',
        'http://10.0.0.1/hooks',
        'http://192.168.1.1/hooks',
        'http://[::1]/hooks',
        'http://[fe80::1]/hooks',
        'http://[fd00::1]/hooks',
        'http://[::ffff:127.0.0.1]/hooks',
    ])('blocks private targets when enabled: %s', async (url) => {
        await expect(
            validateWebhookUrl(url, {
                blockPrivateIps: true,
                resolver: publicResolver,
            })
        ).rejects.toThrow(/private ip/i);
    });

    it('allows private literals when blocking is disabled', async () => {
        const parsed = await validateWebhookUrl('http://127.0.0.1/hooks', {
            blockPrivateIps: false,
        });

        expect(parsed.hostname).toBe('127.0.0.1');
    });

    it('blocks private targets by default', async () => {
        await expect(
            validateWebhookUrl('http://127.0.0.1/hooks')
        ).rejects.toThrow(/private ip/i);
    });

    it('blocks hostnames that resolve to private IPs when enabled', async () => {
        await expect(
            validateWebhookUrl('https://example.com/hooks', {
                blockPrivateIps: true,
                resolver: privateResolver,
            })
        ).rejects.toThrow(/private ip/i);
    });

    it('rejects mixed public and private DNS answers', async () => {
        await expect(
            validateWebhookUrl('https://example.com/hooks', {
                blockPrivateIps: true,
                resolver: async () => [
                    { address: '8.8.8.8', family: 4 },
                    { address: '169.254.169.254', family: 4 },
                ],
            })
        ).rejects.toThrow(/private ip/i);
    });

    it('allows hostnames that resolve to public IPs when enabled', async () => {
        const parsed = await validateWebhookUrl('https://example.com/hooks', {
            blockPrivateIps: true,
            resolver: publicResolver,
        });

        expect(parsed.hostname).toBe('example.com');
    });
});
