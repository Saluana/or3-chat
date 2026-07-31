import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('dev wrapper script wiring', () => {
    const pkg = JSON.parse(
        readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
    ) as {
        scripts: Record<string, string>;
    };

    it('routes `dev` through the port-preflight wrapper', () => {
        expect(pkg.scripts.dev).toBe('tsx scripts/cli/dev.ts');
    });

    it('routes `dev:ssr` through the cross-platform wrapper', () => {
        const script = pkg.scripts['dev:ssr'];
        expect(script).toContain('tsx scripts/cli/dev.ts');
        expect(script).toContain('--or3-ssr');
        expect(script).toContain('--host 127.0.0.1');
        expect(script).toContain('--port 3000');
        expect(script).not.toMatch(/\bnuxt\s+dev\b/);
        expect(script).not.toContain('bun');
    });

    it('routes `dev:offline` through the cross-platform wrapper', () => {
        const script = pkg.scripts['dev:offline'];
        expect(script).toBe('tsx scripts/cli/dev.ts --or3-offline');
        expect(script).not.toMatch(/\bnuxt\s+dev\b/);
        expect(script).not.toContain('bun');
    });

    it('keeps `start` as the one-command entry', () => {
        expect(pkg.scripts.start).toBe('tsx scripts/cli/start.ts');
    });
});
