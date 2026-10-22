// Served temporarily as a browser bundle. Both variants use production modules;
// the baseline build substitutes the reviewed HEAD versions of the two owners.
import { PaletteSourceIndex } from '../../app/core/search/command-palette/source-index';
import { useDocumentInsights } from '../../app/composables/documents/useDocumentInsights';
import { effectScope, shallowRef } from 'vue';
import { Schema } from '@tiptap/pm/model';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const percentile = (samples: number[], p: number) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1]!;

export async function measureSearch(bytes = 16_000_000) {
    const index = new PaletteSourceIndex('bench');
    try {
        await index.replaceAll([{
            key: 'bench:one', sourceId: 'bench', categoryId: 'chat', recordId: 'one', title: 'Large conversation',
            content: 'commonword lorem ipsum '.repeat(Math.ceil(bytes / 23)).slice(0, bytes),
            primaryAction: { id: 'open', label: 'Open', target: { kind: 'chat', threadId: 'one', destination: 'active' } },
        }]);
        const samples: number[] = [];
        for (let i = 0; i < 5; i++) {
            const started = performance.now();
            const result = await index.search({ term: 'commonword', limit: 8 });
            samples.push(performance.now() - started);
            if (result.usingFallback || result.results.length !== 1) throw new Error('Search result regression');
            await pause(0);
        }
        return { bytes, samples, medianMs: percentile(samples, .5), p95Ms: percentile(samples, .95) };
    } finally { index.dispose(); }
}

export async function measureInsights(characters = 2_000_000) {
    const schema = new Schema({ nodes: {
        doc: { content: 'paragraph+' }, paragraph: { content: 'text*', group: 'block' }, text: { group: 'inline' },
    } });
    const paragraphs = Array.from({ length: Math.ceil(characters / 100) }, () =>
        schema.nodes.paragraph!.create(null, schema.text('Ordinary words in a readable paragraph. '.repeat(3).slice(0, 100))));
    let notify = () => {};
    const editor = { state: { doc: schema.nodes.doc!.create(null, paragraphs), selection: { from: 1 } },
        on: (_: string, fn: () => void) => { notify = fn; }, off: () => {} };
    const scope = effectScope();
    const insights = scope.run(() => useDocumentInsights(shallowRef(editor) as unknown as Parameters<typeof useDocumentInsights>[0]))!;
    try {
        await pause(200);
        const originalWords = insights.stats.value.words;
        const firstFrameSamples: number[] = [];
        for (let i = 0; i < 8; i++) {
            editor.state.doc = schema.nodes.doc!.create(null, [
                schema.nodes.paragraph!.create(null, schema.text(`Extra word ${i}`)), ...paragraphs,
            ]);
            const started = performance.now();
            notify();
            await new Promise<void>(resolve => requestAnimationFrame(() => {
                firstFrameSamples.push(performance.now() - started); resolve();
            }));
            await pause(180);
            if (insights.stats.value.words !== originalWords + 3) throw new Error('Statistics regression');
        }
        return { characters, firstFrameSamples, medianFrameMs: percentile(firstFrameSamples, .5),
            p95FrameMs: percentile(firstFrameSamples, .95), words: insights.stats.value.words };
    } finally { scope.stop(); }
}
