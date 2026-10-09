import { afterEach, expect, it, vi } from 'vitest';

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock('~/utils/chat/history-tools', () => ({ registerHistoryTools: register }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('allows app startup when optional history tools cannot initialize', async () => {
    vi.stubGlobal('defineNuxtPlugin', (setup: () => void) => setup);
    register.mockImplementation(() => { throw new Error('Secure random generation is unavailable'); });
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { default: setup } = await import('../history-tools.client');
    expect(() => setup({} as Parameters<typeof setup>[0])).not.toThrow();
    expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining('history-tools'), expect.any(Error));
});
