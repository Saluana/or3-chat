import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = new URL('./', import.meta.url);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summarize = prefix => {
    const runs = [1, 2, 3].map(index => {
        const file = `${prefix}-${index}.json`;
        const data = JSON.parse(readFileSync(new URL(file, directory), 'utf8'));
        return {
            file,
            readyMs: data.proof.readyMs,
            fcpMs: data.proof.paints.find(paint => paint.name === 'first-contentful-paint')?.startMs,
            lcpMs: data.proof.lcp.at(-1)?.startMs,
            cls: data.proof.shifts.reduce((sum, shift) => sum + shift.value, 0),
            htmlTransferBytes: data.navigation[0].transferBytes,
            encodedJsBytes: data.resources.filter(resource => resource.path.endsWith('.js'))
                .reduce((sum, resource) => sum + resource.encodedBytes, 0),
            geometry: data.geometry,
        };
    });
    return { runs, median: Object.fromEntries(
        ['readyMs', 'fcpMs', 'lcpMs', 'cls', 'htmlTransferBytes', 'encodedJsBytes']
            .map(metric => [metric, median(runs.map(run => run[metric]))])
    ) };
};
const baseline = summarize('baseline');
const final = summarize('final');
const result = {
    baselineCommit: '452f7ec0a0bfb1de849bd3adb5ee3ac9715df540',
    profile: { browser: 'Chrome 155', viewport: '390x844', dpr: 1, cpuSlowdown: 4,
        latencyMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750,
        cacheDisabled: true, serviceWorkerBypassed: true },
    baseline, final,
    readyImprovementMs: baseline.median.readyMs - final.median.readyMs,
    readyImprovementPercent: (1 - final.median.readyMs / baseline.median.readyMs) * 100,
    composerGeometryUnchanged: JSON.stringify(baseline.runs[0].geometry) === JSON.stringify(final.runs[0].geometry),
};
writeFileSync(new URL('summary.json', directory), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ path: fileURLToPath(new URL('summary.json', directory)), baseline: baseline.median,
    final: final.median, readyImprovementMs: result.readyImprovementMs,
    readyImprovementPercent: result.readyImprovementPercent,
    composerGeometryUnchanged: result.composerGeometryUnchanged }, null, 2));
