import { describe, expect, it } from 'vitest';
import { buildConnectCommand } from '../connect-command';

describe('buildConnectCommand', () => {
    it('adds the configured self-hosted OR3 origin', () => {
        expect(buildConnectCommand('https://chat.example.com/')).toBe(
            'npx @or3/connect --cloud-url https://chat.example.com'
        );
    });

    it('does not give a self-hosted user a command for another OR3 origin', () => {
        expect(buildConnectCommand('')).toBeUndefined();
        expect(buildConnectCommand('https://chat.example.com/connect')).toBeUndefined();
    });
});
