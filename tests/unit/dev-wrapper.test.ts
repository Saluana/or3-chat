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
        expect(pkg.scripts.dev).toBe('bun run scripts/cli/dev.ts');
    });

    it('routes `dev:ssr` through `bun run dev` (wrapper + SSR env)', () => {
        const script = pkg.scripts['dev:ssr'];
        expect(script).toContain('SSR_AUTH_ENABLED=true');
        expect(script).toContain('bun run dev');
        expect(script).toContain('--host 127.0.0.1');
        expect(script).toContain('--port 3000');
        // Must not bypass the wrapper by calling nuxt directly.
        expect(script).not.toMatch(/\bnuxt\s+dev\b/);
    });

    it('routes `dev:offline` through `bun run dev` with cloud features off', () => {
        const script = pkg.scripts['dev:offline'];
        expect(script).toContain('SSR_AUTH_ENABLED=false');
        expect(script).toContain('OR3_SYNC_ENABLED=false');
        expect(script).toContain('OR3_STORAGE_ENABLED=false');
        expect(script).toContain('bun run dev');
        expect(script).not.toMatch(/\bnuxt\s+dev\b/);
    });

    it('keeps `start` as the one-command entry', () => {
        expect(pkg.scripts.start).toBe('bun run scripts/cli/start.ts');
    });
});
