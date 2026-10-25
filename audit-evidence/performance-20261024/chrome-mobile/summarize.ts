import { readFile, writeFile } from 'node:fs/promises';

const directory = new URL('./', import.meta.url);
const read = async (name: string) => JSON.parse(await readFile(new URL(name, directory), 'utf8'));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const startup = async (kind: string) => {
    const samples = await Promise.all([1, 2, 3].map(async (index) => {
        const value = await read(`${kind}-${index}.json`);
        return {
            sample: index,
            fcpMs: value.proof.paints.find((entry: { name: string }) => entry.name === 'first-contentful-paint').startMs,
            lcpMs: value.proof.lcp.at(-1).startMs,
            readyObservedMs: value.proof.readyMs,
            localResources: value.resources.length,
        };
    }));
    return {
        samples,
        medianFcpMs: median(samples.map(value => value.fcpMs)),
        medianLcpMs: median(samples.map(value => value.lcpMs)),
        medianReadyObservedMs: median(samples.map(value => value.readyObservedMs)),
    };
};

const foreground = await Promise.all(['call-1.json', 'call-2.json', 'call-5-stopped.json'].map(async file => {
    const value = await read(file);
    const call = value.proof.proof.calls.at(-1);
    return {
        file,
        firstVisibleTextMs: call.firstTextMs - call.sendMs,
        settledMs: call.completeMs - call.sendMs,
        observedFinalMarkdownSectionChars: call.textLength,
        uiUsage: value.uiUsage,
    };
}));
const summary = {
    sourceCommit: '55d47ec77b38e40b9d473f26af1c1f7af39e33a6',
    browser: 'Installed Google Chrome 155; user profile, extension connection',
    profile: { width: 390, height: 844, dpr: 1, touchPoints: 5, cpuRate: 4,
        latencyMs: 150, downBytesPerSecond: 200_000, upBytesPerSecond: 93_750,
        serviceWorkerBypassed: true },
    cold: await startup('cold'),
    warm: await startup('warm'),
    foreground,
    stoppedPersistence: await read('stopped-after-reload.json'),
    cleanup: await read('cleanup.json'),
    limitations: [
        'Ready is the first observation of the app-init flag plus mounted editor; warm samples can be upper bounds because instrumentation is installed after reload.',
        'Calls 3 and 4 completed but are excluded from timing conclusions: virtualization changes the observer Markdown node-count baseline.',
        'Call 2 network events were evicted; call 1 response body was unavailable. Visible app receipts supply token usage, not an independently verified bill.',
        'These are current-build observations, not a Chrome before/after optimization comparison or physical-phone qualification.',
    ],
};
await writeFile(new URL('summary.json', directory), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
