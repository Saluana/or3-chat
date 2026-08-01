import { describe, expect, it } from 'vitest';
import { makeMeta } from './test-utils';
import {
    filterImageLibrary,
    imageLibraryCounts,
    isGeneratedImage,
    sortImageLibrary,
} from '../image-library';

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
});
