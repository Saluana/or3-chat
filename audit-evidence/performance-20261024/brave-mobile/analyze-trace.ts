import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

interface TraceData {
    documentLoaderURL?: string;
    navigationId?: string;
    requestId?: string;
    url?: string;
    mimeType?: string;
    fromCache?: boolean;
    fromServiceWorker?: boolean;
    encodedDataLength?: number;
    decodedBodyLength?: number;
    nodeName?: string;
    isMainFrame?: boolean;
    score?: number;
    had_recent_input?: boolean;
}
interface TraceEvent {
    name: string;
    ts: number;
    dur?: number;
    pid: number;
    tid: number;
    args?: { data?: TraceData; frame?: string; snapshot?: string };
}
interface Trace {
    metadata: {
        startTime: string;
        emulatedDeviceTitle: string;
        cpuThrottling: number;
        networkThrottling: string;
        networkThrottlingConditions: Record<string, unknown>;
    };
    traceEvents: TraceEvent[];
}
interface Resource {
    path: string;
    startMs: number;
    endMs?: number;
    mime?: string;
    cached?: boolean;
    serviceWorker?: boolean;
    encodedBytes?: number;
    decodedBytes?: number;
}

const [input, output] = process.argv.slice(2);
if (!input || !output)
    throw new Error('Usage: bun analyze-trace.ts input.json.gz output.json');
const raw = readFileSync(input);
const trace = JSON.parse(gunzipSync(raw).toString()) as Trace;
const navigation = trace.traceEvents.find(
    (event) =>
        event.name === 'navigationStart' &&
        event.args?.data?.documentLoaderURL === 'http://127.0.0.1:3152/chat'
);
if (!navigation) throw new Error('Missing local audit navigation');
const elapsed = (event: TraceEvent) =>
    Math.round((event.ts - navigation.ts) / 1000);
const mainThread = (event: TraceEvent) =>
    event.pid === navigation.pid && event.tid === navigation.tid;
const resources = new Map<string, Resource>();
const paints: Array<{ name: string; ms: number; node?: string }> = [];
const longTasks: number[] = [];
let dclMs: number | undefined;
let loadMs: number | undefined;
let lastFrame: string | undefined;
for (const event of trace.traceEvents) {
    if (event.ts < navigation.ts) continue;
    const data = event.args?.data;
    if (
        event.name === 'ResourceSendRequest' &&
        data?.requestId &&
        data.url?.startsWith('http://127.0.0.1:3152/')
    ) {
        resources.set(data.requestId, {
            path: new URL(data.url).pathname,
            startMs: elapsed(event),
        });
    }
    const resource = data?.requestId
        ? resources.get(data.requestId)
        : undefined;
    if (resource && event.name === 'ResourceReceiveResponse') {
        resource.mime = data?.mimeType;
        resource.cached = data?.fromCache;
        resource.serviceWorker = data?.fromServiceWorker;
    }
    if (resource && event.name === 'ResourceFinish') {
        resource.endMs = elapsed(event);
        resource.encodedBytes = data?.encodedDataLength;
        resource.decodedBytes = data?.decodedBodyLength;
    }
    if (mainThread(event)) {
        if (event.name === 'firstContentfulPaint')
            paints.push({ name: 'FCP', ms: elapsed(event) });
        if (
            event.name === 'largestContentfulPaint::Candidate' &&
            data?.navigationId === navigation.args?.data?.navigationId
        ) {
            paints.push({
                name: 'LCP candidate',
                ms: elapsed(event),
                node: data?.nodeName,
            });
        }
        if (event.name === 'MarkDOMContent') dclMs = elapsed(event);
        if (event.name === 'MarkLoad') loadMs = elapsed(event);
        if (event.name === 'RunTask' && (event.dur ?? 0) > 50_000)
            longTasks.push((event.dur ?? 0) / 1000);
    }
    if (event.name === 'Screenshot' && event.args?.snapshot)
        lastFrame = event.args.snapshot;
}
const rows = [...resources.values()];
const { metadata } = trace;
const report = {
    rawTraceSha256: createHash('sha256').update(raw).digest('hex'),
    startTime: metadata.startTime,
    emulatedDeviceTitle: metadata.emulatedDeviceTitle,
    cpuThrottling: metadata.cpuThrottling,
    networkThrottling: metadata.networkThrottling,
    networkThrottlingConditions: metadata.networkThrottlingConditions,
    paints,
    dclMs,
    loadMs,
    lcpMs: paints.filter((paint) => paint.name === 'LCP candidate').at(-1)?.ms,
    complete: rows.every((resource) => resource.endMs !== undefined),
    requestCount: rows.length,
    transferredBytes: rows.reduce(
        (sum, resource) => sum + (resource.encodedBytes ?? 0),
        0
    ),
    mainThreadLongTasks: {
        count: longTasks.length,
        maxMs: Math.max(0, ...longTasks),
        totalBlockingMs: Math.round(
            longTasks.reduce((sum, ms) => sum + ms - 50, 0)
        ),
    },
    resources: rows,
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
if (lastFrame)
    writeFileSync(
        output.replace(/\.json$/, '-last-frame.jpg'),
        Buffer.from(lastFrame, 'base64')
    );
console.log(
    JSON.stringify({
        output,
        lcpMs: report.lcpMs,
        dclMs,
        loadMs,
        requestCount: rows.length,
        complete: report.complete,
    })
);
