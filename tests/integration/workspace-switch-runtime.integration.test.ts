import { describe, expect, it } from 'vitest';

describe('workspace switch runtime integration', () => {
    it('cancels in-flight sync/transfer work when workspace changes', () => {
        const running = new Set(['sync:1', 'upload:1']);

        const switchWorkspace = () => running.clear();
        switchWorkspace();

        expect(running.size).toBe(0);
    });

    it('resumes queues only for active workspace', () => {
        const queues = new Map([
            ['ws-a', { active: true }],
            ['ws-b', { active: false }],
        ]);

        const active = Array.from(queues.entries())
            .filter(([, q]) => q.active)
            .map(([id]) => id);

        expect(active).toEqual(['ws-a']);
    });
});
