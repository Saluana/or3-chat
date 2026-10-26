import { readFile, writeFile } from 'node:fs/promises';
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const groups = {};
for (const group of ['baseline', 'final-cold', 'final-warm', 'final-unthrottled']) {
    const runs = [];
    for (const number of [1, 2, 3]) {
        const data = JSON.parse(await readFile(new URL(`${group}-${number}.json`, import.meta.url)));
        runs.push({
            file: `${group}-${number}.json`,
            fcpMs: data.proof.paints.find(item => item.name === 'first-contentful-paint')?.startMs,
            lcpMs: data.proof.lcp.at(-1)?.startMs,
            readyUpperBoundMs: data.proof.readyMs,
            cls: data.proof.shifts.reduce((sum, entry) => sum + entry.value, 0),
            javascriptEncodedBytes: data.resources.filter(item => item.path.endsWith('.js')).reduce((sum, item) => sum + item.encodedBytes, 0),
            artworkEncodedBytes: data.resources.filter(item => /bird-on-cloud|blank-chat-(?:background|bg)/.test(item.path)).reduce((sum, item) => sum + item.encodedBytes, 0),
        });
    }
    groups[group] = { runs, median: Object.fromEntries(Object.keys(runs[0]).filter(key => key !== 'file').map(key => [key, median(runs.map(run => run[key]))])) };
}
await writeFile(new URL('summary.json', import.meta.url), JSON.stringify(groups, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(groups).map(([name, data]) => [name, data.median])), null, 2));
