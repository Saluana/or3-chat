// Run with Bun from the repository root. Remove public/.or3-review-performance after testing.
import path from 'node:path';
const root = process.cwd();
const owners = [
    'app/core/search/command-palette/source-index.ts',
    'app/composables/documents/useDocumentInsights.ts',
];
const revision = process.env.OR3_REVIEW_BASELINE ?? 'c299552915aa0f3977673bcfa702f539d225a6c8';
for (const variant of ['before', 'after']) {
    const result = await Bun.build({
        entrypoints: [path.join(import.meta.dir, 'browser-benchmark.ts')],
        outdir: path.join(root, 'public/.or3-review-performance'), naming: `${variant}.js`,
        target: 'browser', minify: false, sourcemap: 'none',
        plugins: [{ name: 'review-baseline', setup(build) {
            build.onResolve({ filter: /^~\// }, args => ({ path: path.join(root, 'app', args.path.slice(2) + '.ts') }));
            if (variant !== 'before') return;
            build.onLoad({ filter: /(?:source-index|useDocumentInsights)\.ts$/ }, args => {
                const relative = path.relative(root, args.path);
                if (!owners.includes(relative)) return;
                const source = Bun.spawnSync(['git', 'show', `${revision}:${relative}`]);
                if (source.exitCode) throw new Error(source.stderr.toString());
                return { contents: source.stdout.toString(), loader: 'ts' };
            });
        } }],
    });
    if (!result.success) throw new AggregateError(result.logs, `Could not build ${variant}`);
    console.log(`${variant}: ${result.outputs[0]!.size} bytes`);
}
console.log(`Baseline revision: ${Bun.spawnSync(['git', 'rev-parse', revision]).stdout.toString().trim()}`);
