#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
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
    const timeoutMs = options.timeoutMs ?? 8 * 60 * 1000;
    const pollMs = options.pollMs ?? 2_000;
    const statusErrorTimeoutMs = options.statusErrorTimeoutMs ?? 45_000;
    const statePath = options.statePath;
    const log = options.log ?? ((message) => console.log(message));
    const startedAt = Date.now();
    const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    log(`[dashboard-smoke +${elapsed()}] checking release metadata for ${targetVersion}`);
    const checked = await operatorRequest(socketPath, 'POST', '/check');
    if (
        checked.status !== 200
        || checked.body?.latestVersion !== targetVersion
        || checked.body?.updateAvailable !== true
    ) {
        throw new Error(`Dashboard operator did not offer ${targetVersion}: ${JSON.stringify(checked)}`);
    }

    log(`[dashboard-smoke +${elapsed()}] release check passed; testing serialized update start`);
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

    log(`[dashboard-smoke +${elapsed()}] update job ${jobId} accepted`);
    const deadline = Date.now() + timeoutMs;
    let lastError;
    let statusErrorStartedAt;
    let lastJobPhase;
    let lastOperationPhase;
    let lastProgressLogAt = 0;
    while (Date.now() < deadline) {
        let status;
        try {
            status = await operatorRequest(socketPath, 'GET', '/status');
            if (status.status !== 200) throw new Error(`status ${status.status}`);
            if (statusErrorStartedAt) {
                log(`[dashboard-smoke +${elapsed()}] operator status recovered after ${((Date.now() - statusErrorStartedAt) / 1000).toFixed(1)}s`);
            }
            lastError = undefined;
            statusErrorStartedAt = undefined;
        } catch (error) {
            lastError = error;
            statusErrorStartedAt ??= Date.now();
            if (Date.now() - statusErrorStartedAt >= statusErrorTimeoutMs) {
                const detail = error instanceof Error ? error.message : String(error);
                throw new Error(`Dashboard operator status was continuously unavailable for ${(statusErrorTimeoutMs / 1000).toFixed(0)}s during job ${jobId}: ${detail}`);
            }
        }
        const job = status?.body?.job;
        if (job?.id === jobId && job.phase !== lastJobPhase) {
            lastJobPhase = job.phase;
            log(`[dashboard-smoke +${elapsed()}] operator job phase: ${job.phase}`);
        }
        let durableJob;
        if (statePath) {
            try {
                const state = JSON.parse(await readFile(statePath, 'utf8'));
                const operationPhase = state?.incompleteOperation?.phase ?? 'idle';
                if (operationPhase !== lastOperationPhase) {
                    lastOperationPhase = operationPhase;
                    log(`[dashboard-smoke +${elapsed()}] managed lifecycle phase: ${operationPhase}`);
                }
                durableJob = JSON.parse(await readFile(join(dirname(statePath), 'dashboard-update.json'), 'utf8'));
            } catch {
                // The state file is briefly replaced atomically during updates.
            }
        }
        if (durableJob?.id === jobId && durableJob.phase === 'succeeded') {
            log(`[dashboard-smoke +${elapsed()}] durable update job succeeded; operator handoff is verified by the next release check`);
            return durableJob;
        }
        if (durableJob?.id === jobId && ['failed', 'needs_attention'].includes(durableJob.phase)) {
            throw new Error(`Dashboard update ended in ${durableJob.phase}: ${durableJob.error || 'no diagnostic'}`);
        }
        if (job?.id === jobId && job.phase === 'succeeded') {
            log(`[dashboard-smoke +${elapsed()}] update job succeeded`);
            return job;
        }
        if (job?.id === jobId && ['failed', 'needs_attention'].includes(job.phase)) {
            throw new Error(`Dashboard update ended in ${job.phase}: ${job.error || 'no diagnostic'}`);
        }
        if (Date.now() - lastProgressLogAt >= 30_000) {
            lastProgressLogAt = Date.now();
            log(`[dashboard-smoke +${elapsed()}] waiting; job=${job?.phase ?? 'unavailable'} lifecycle=${lastOperationPhase ?? 'unknown'}`);
        }
        await delay(pollMs);
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError || '');
    throw new Error(`Dashboard update job ${jobId} did not succeed within ${(timeoutMs / 1000).toFixed(0)}s; last job phase=${lastJobPhase ?? 'unavailable'}, lifecycle phase=${lastOperationPhase ?? 'unknown'}.${detail ? ` Last status error: ${detail}` : ''}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const [socketPath, targetVersion] = process.argv.slice(2);
    if (!socketPath || !/^\d+\.\d+\.\d+$/.test(targetVersion || '')) {
        throw new Error('Usage: smoke-dashboard-update.mjs <operator-socket> <target-version>');
    }
    const timeoutMs = Number(process.env.OR3_DASHBOARD_SMOKE_TIMEOUT_MS || 8 * 60 * 1000);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 60_000 || timeoutMs > 15 * 60 * 1000) {
        throw new Error('OR3_DASHBOARD_SMOKE_TIMEOUT_MS must be between 60000 and 900000.');
    }
    const job = await runDashboardUpdateSmoke(socketPath, targetVersion, {
        timeoutMs,
        statePath: process.env.OR3_DASHBOARD_STATE_PATH,
    });
    console.log(`Dashboard update ${job.id} reached ${job.phase}.`);
}
