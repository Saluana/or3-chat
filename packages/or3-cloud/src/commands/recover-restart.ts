import { request } from 'node:http';
import { join } from 'node:path';
import { readRestartJournal } from '../../../../shared/server/restarts/controller';
import { boolFlag, type Flags } from '../cli/args';
import { deploymentPaths } from '../deployment/paths';

/** Recovery observes proof or cancels a pre-stop request; it never repeats stop. */
export async function recoverRestart(directory: string, flags: Flags): Promise<boolean> {
    let journal;
    try { journal = await readRestartJournal(join(directory, '.or3-cloud', 'restarts', 'restarts.json')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw new Error('The restart journal is invalid. Inspect deployment diagnostics before reconciliation.'); }
    const operation = journal.operations.find(o => !['succeeded', 'cancelled', 'failed'].includes(o.phase));
    if (!operation) return false;
    if (boolFlag(flags, 'dry-run')) {
        console.log(JSON.stringify({ kind: 'or3-restart-recovery', requestId: operation.requestId, phase: operation.phase,
            executionIntent: operation.executionIntent, action: operation.executionIntent ? 'observe-new-boot' : 'cancel-before-stop',
            guidance: 'recover --finish asks the installed operator to verify this receipt. It never repeats a restart or restores data.' }, null, 2));
        return true;
    }
    if (!boolFlag(flags, 'finish') || boolFlag(flags, 'restore')) throw new Error('The restart is unresolved. Inspect recover --dry-run, then use recover --finish to reconcile it. Data restoration is not a restart recovery action.');
    const value = JSON.stringify({ requestId: operation.requestId });
    await new Promise<void>((resolve, reject) => {
        const req = request({ socketPath: join(deploymentPaths(directory).operatorIpc, 'operator.sock'), path: '/lifecycle/v1/reconcile', method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(value) } }, response => {
            let bytes = 0;
            response.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) req.destroy(new Error('Restart recovery response exceeded its limit.')); });
            response.on('error', reject);
            response.on('end', () => { clearTimeout(timer); if (response.statusCode === 200) resolve(); else reject(new Error('Restart recovery is unverified. Keep the receipt and inspect app/operator diagnostics; no additional restart was executed.')); });
        });
        const timer = setTimeout(() => req.destroy(new Error('Restart recovery observation timed out.')), 15_000);
        req.on('error', error => { clearTimeout(timer); reject(error); }); req.end(value);
    });
    console.log('Restart receipt reconciled. No additional restart or data restoration was executed.');
    return true;
}
