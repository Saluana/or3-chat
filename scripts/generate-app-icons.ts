import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

// Run with Bun. Uses the project's existing Playwright Chromium installation.
// Never changes the favicon or the authentic logo source.
const { values } = parseArgs({
    options: {
        'source-root': { type: 'string' },
        'output-root': { type: 'string' },
    },
});
const root = resolve(import.meta.dir, '..');
const sourceRoot = resolve(values['source-root'] ?? root);
const outputRoot = resolve(values['output-root'] ?? root);
const directory = resolve(outputRoot, 'public/logos');
const source = await readFile(resolve(sourceRoot, 'public/logos/icon-logo-svg.svg'), 'utf8');
const viewBox = source.match(/viewBox="([\d. ]+)"/)?.[1];
const artwork = source.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/)?.[1];
if (!viewBox || !artwork) throw new Error('Expected the authentic OR3 icon SVG.');
const [, , width, height] = viewBox.split(' ').map(Number);
const background = '#0b0f1a';

function compose(coverage: number) {
    const w = 1024 * coverage;
    const h = w * height / width;
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${background}"/><svg x="${(1024 - w) / 2}" y="${(1024 - h) / 2}" width="${w}" height="${h}" viewBox="${viewBox}">${artwork}</svg></svg>\n`;
}

// Full square backgrounds: the OS applies its own corner shape.
const regular = compose(0.72);
// Bounding-box half-diagonal < 0.4, so even the entire SVG is in the safe circle.
const maskable = compose(0.56);
const assets = [
    ['app-icon-192.png', 192, regular],
    ['app-icon-512.png', 512, regular],
    ['app-icon-1024.png', 1024, regular],
    ['app-icon-maskable-192.png', 192, maskable],
    ['app-icon-maskable-512.png', 512, maskable],
    ['apple-touch-icon.png', 180, regular],
] as const;

await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage();
    for (const [name, size, svg] of assets) {
        const png = await page.evaluate(async ({ size, svg }) => {
            const image = new Image();
            image.src = `data:image/svg+xml;base64,${btoa(svg)}`;
            await image.decode();
            const large = document.createElement('canvas');
            large.width = large.height = size * 4;
            large.getContext('2d')!.drawImage(image, 0, 0, size * 4, size * 4);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const context = canvas.getContext('2d')!;
            context.imageSmoothingQuality = 'high';
            context.drawImage(large, 0, 0, size, size);
            return canvas.toDataURL('image/png').split(',')[1];
        }, { size, svg });
        await writeFile(resolve(directory, name), Buffer.from(png, 'base64'));
        console.log(`${name}: ${size}x${size}`);
    }
    await writeFile(resolve(directory, 'app-icon.svg'), regular);
    await writeFile(resolve(directory, 'app-icon-maskable.svg'), maskable);
} finally {
    await browser.close();
}
