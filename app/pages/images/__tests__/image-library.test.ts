import { describe, expect, it } from 'vitest';
import { makeMeta } from './test-utils';
import type { ImageSummary } from '~/db/files-select';
import {
    filterImageLibrary,
    imageLibraryCounts,
    imageSummaryCounts,
    isGeneratedImage,
    isGeneratedImageName,
    orderImageSummariesByName,
    sortImageLibrary,
} from '../image-library';

function makeSummary(
    hash: string,
    overrides: Partial<ImageSummary> = {}
): ImageSummary {
    return {
        hash,
        name: `image-${hash}.png`,
        mime_type: 'image/png',
        created_at: 1,
        size_bytes: 1,
        state: 'active',
        ...overrides,
    };
}

describe('image library views', () => {
    const uploaded = {
        ...makeMeta('upload'),
        name: 'brand-photo.png',
        created_at: 10,
        size_bytes: 200,
    };
    const generated = {
        ...makeMeta('generated'),
        name: 'gen-image',
        created_at: 20,
        size_bytes: 100,
    };

    it('classifies generated images without a schema migration', () => {
        expect(isGeneratedImage(generated)).toBe(true);
        expect(isGeneratedImage(uploaded)).toBe(false);
    });

    it('filters source and document-usage views', () => {
        const items = [uploaded, generated];
        expect(
            filterImageLibrary(items, 'uploads', new Set()).map(
                (item) => item.hash
            )
        ).toEqual(['upload']);
        expect(
            filterImageLibrary(items, 'generated', new Set()).map(
                (item) => item.hash
            )
        ).toEqual(['generated']);
        expect(
            filterImageLibrary(items, 'used-in-docs', new Set(['upload'])).map(
                (item) => item.hash
            )
        ).toEqual(['upload']);
    });

    it('sorts independently from the active filter', () => {
        expect(sortImageLibrary([uploaded, generated], 'newest')[0]?.hash).toBe(
            'generated'
        );
        expect(
            sortImageLibrary([uploaded, generated], 'largest')[0]?.hash
        ).toBe('upload');
    });

    it('builds navigation counts', () => {
        const counts = imageLibraryCounts(
            [uploaded, generated],
            [{ ...uploaded, hash: 'trash', deleted: true }],
            new Set(['upload'])
        );
        expect(counts).toEqual({
            all: 2,
            uploads: 1,
            generated: 1,
            'used-in-docs': 1,
            trash: 1,
        });
    });

    it('classifies generated summaries and counts the compact corpus', () => {
        const summaries = [
            makeSummary('upload', { name: 'brand-photo.png' }),
            makeSummary('generated', { name: 'gen-image' }),
            makeSummary('used', { name: 'hero.png' }),
            makeSummary('trash', { name: 'old.png', state: 'trash' }),
        ];
        expect(isGeneratedImageName('gen-image')).toBe(true);
        expect(isGeneratedImageName('generated image')).toBe(true);
        expect(isGeneratedImageName('brand-photo.png')).toBe(false);
        expect(imageSummaryCounts(summaries, new Set(['used', 'trash']))).toEqual(
            {
                all: 3,
                uploads: 2,
                generated: 1,
                'used-in-docs': 1,
                trash: 1,
            }
        );
    });

    it('orders summaries by locale-aware name with deterministic ties', () => {
        const summaries = [
            makeSummary('h1', { name: 'banana.png' }),
            makeSummary('h2', { name: 'apple.png' }),
            makeSummary('h3', { name: 'Apple.png' }),
            makeSummary('h4', { name: 'apple.png' }),
        ];

        // Case-insensitive equality falls back to hash order.
        expect(orderImageSummariesByName(summaries, 'name-asc')).toEqual([
            'h2',
            'h3',
            'h4',
            'h1',
        ]);
        expect(orderImageSummariesByName(summaries, 'name-desc')).toEqual([
            'h1',
            'h2',
            'h3',
            'h4',
        ]);
    });
});
