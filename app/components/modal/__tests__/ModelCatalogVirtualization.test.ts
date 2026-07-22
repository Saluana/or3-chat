import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
    resolve(process.cwd(), 'app/components/modal/ModelCatalog.vue'),
    'utf8'
);

describe('ModelCatalog virtualization', () => {
    it('uses the shared OR3 scroller in top-oriented catalog mode', () => {
        expect(source).toContain("import { Or3Scroll } from 'or3-scroll'");
        expect(source).toContain('<Or3Scroll');
        expect(source).toContain(':items="visibleModels"');
        expect(source).toContain(':item-key="(model) => model.id"');
        expect(source).toContain(':maintain-bottom="false"');
        expect(source).toContain(':key="listKey"');
        expect(source).toContain('`${searchQuery.value.trim()}|${scope.value}');
        expect(source).not.toContain("from 'virtua/vue'");
        expect(source).not.toContain('<VList');
    });
});
