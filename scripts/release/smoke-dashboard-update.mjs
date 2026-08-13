#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

function operatorRequest(socketPath, method, path, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolveRequest, rejectRequest) => {
        const client = request({
            socketPath,
            method,
            path,
            headers: payload ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
            } : undefined,
        }, (response) => {
            const chunks = [];
            let total = 0;
            response.on('data', (chunk) => {
                total += chunk.length;
                if (total > 32 * 1024) {
                    response.destroy(new Error('Dashboard operator smoke response exceeded 32 KiB.'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => {
                try {
                    resolveRequest({
                        status: response.statusCode ?? 500,
                        body: JSON.parse(Buffer.concat(chunks, total).toString('utf8')),
                    });
                } catch {
                    rejectRequest(new Error('Dashboard operator smoke returned invalid JSON.'));
                }
            });
            response.once('error', rejectRequest);
        });
        client.setTimeout(15_000, () => client.destroy(new Error('Dashboard operator smoke request timed out.')));
        client.once('error', rejectRequest);
        client.end(payload);
    });
}

export async function runDashboardUpdateSmoke(socketPath, targetVersion, options = {}) {
    const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
    const pollMs = options.pollMs ?? 2_000;
    const checked = await operatorRequest(socketPath, 'POST', '/check');
    if (
        checked.status !== 200
        || checked.body?.latestVersion !== targetVersion
        || checked.body?.updateAvailable !== true
    ) {
        throw new Error(`Dashboard operator did not offer ${targetVersion}: ${JSON.stringify(checked)}`);
    }

    const requests = [randomUUID(), randomUUID()].map((requestId) => ({ requestId, targetVersion }));
    const starts = await Promise.all(requests.map((body) => operatorRequest(socketPath, 'POST', '/start', body)));
    const accepted = starts.filter((result) => result.status === 202);
    const conflicts = starts.filter((result) => result.status === 409);
    if (accepted.length !== 1 || conflicts.length !== 1) {
        throw new Error(`Concurrent dashboard starts were not serialized: ${JSON.stringify(starts)}`);
    }
    const jobId = accepted[0].body?.job?.id;
    if (!requests.some((entry) => entry.requestId === jobId)) {
        throw new Error('Dashboard operator accepted an unexpected job identity.');
    }

    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        let status;
        try {
            status = await operatorRequest(socketPath, 'GET', '/status');
            if (status.status !== 200) throw new Error(`status ${status.status}`);
            lastError = undefined;
        } catch (error) {
            lastError = error;
        }
        const job = status?.body?.job;
        if (job?.id === jobId && job.phase === 'succeeded') return job;
        if (job?.id === jobId && ['failed', 'needs_attention'].includes(job.phase)) {
            throw new Error(`Dashboard update ended in ${job.phase}: ${job.error || 'no diagnostic'}`);
        }
        await delay(pollMs);
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError || '');
    throw new Error(`Dashboard update did not succeed before the deadline.${detail ? ` Last status error: ${detail}` : ''}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const [socketPath, targetVersion] = process.argv.slice(2);
    if (!socketPath || !/^\d+\.\d+\.\d+$/.test(targetVersion || '')) {
        throw new Error('Usage: smoke-dashboard-update.mjs <operator-socket> <target-version>');
    }
    const job = await runDashboardUpdateSmoke(socketPath, targetVersion);
    console.log(`Dashboard update ${job.id} reached ${job.phase}.`);
}
