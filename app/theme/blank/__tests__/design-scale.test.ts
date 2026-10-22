import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), 'app/theme/blank');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const styles = read('styles.css');
const sources = [
    ['styles.css', styles],
    ['theme.ts', read('theme.ts')],
    ...readdirSync(resolve(root, 'styles'))
        .filter((file) => file.endsWith('.ts'))
        .map((file) => [`styles/${file}`, read(`styles/${file}`)] as const),
] as const;

/**
 * Declared font sizes, in px, for every `font-size`, `fontSize` and `text-[Npx]`
 * literal. Selectors that merely *name* a shared component's size class
 * (`[class~='text-[10.5px]']`) are not declarations and are skipped.
 */
function fontSizes(source: string): number[] {
    const sizes: number[] = [];
    for (const match of source.matchAll(
        /(?:font-size:\s*|fontSize:\s*'|(?<!class~=['"])text-\[)(\d+(?:\.\d+)?)(px|rem)/g,
    )) {
        const value = Number(match[1]);
        sizes.push(match[2] === 'rem' ? value * 16 : value);
    }
    return sizes;
}

describe('blank theme design scale', () => {
    it('never declares text below the 12px caption size', () => {
        for (const [name, source] of sources) {
            const small = fontSizes(source).filter((size) => size > 0 && size < 12);
            expect(small, `${name} declares sub-12px text`).toEqual([]);
        }
    });

    it('uses whole-pixel type sizes (no 0.78rem-style fractions)', () => {
        for (const [name, source] of sources) {
            const fractional = fontSizes(source).filter((size) => !Number.isInteger(size));
            expect(fractional, `${name} declares fractional text sizes`).toEqual([]);
        }
    });

    it('uses only the 400 / 500 / 600 weight steps', () => {
        for (const [name, source] of sources) {
            const weights = [
                ...source.matchAll(/(?:font-weight:\s*|fontWeight:\s*')(\d{3})/g),
            ].map((match) => Number(match[1]));
            expect(
                weights.filter((weight) => ![400, 500, 600].includes(weight)),
                `${name} uses an off-scale weight`,
            ).toEqual([]);
        }
    });

    it('anchors every top-level rule to html[data-theme] so shared component CSS cannot tie it', () => {
        // A bare `[data-theme="blank"]` selector ties with `.component[data-v-…]`
        // rules, and the winner then depends on stylesheet load order.
        expect(styles).not.toMatch(/^\[data-theme=["']blank["']\]/m);
        expect(styles).not.toMatch(/^\.dark \[data-theme/m);
    });

    it('defines the shared type, radius and rail tokens it consumes', () => {
        for (const token of [
            '--blank-text-caption: 12px',
            '--blank-text-body: 14px',
            '--blank-text-reading: 15px',
            '--blank-text-message: 16px',
            '--blank-text-title: 20px',
            '--blank-radius-xs: 6px',
            '--blank-radius-xl: 20px',
            '--blank-control-rail: 40px',
            '--blank-sb-inset: 14px',
        ]) {
            expect(styles).toContain(token);
        }
    });
});
