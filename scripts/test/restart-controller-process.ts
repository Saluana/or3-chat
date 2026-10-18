import { createServer } from 'node:http';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RestartController, RestartError } from '../../shared/server/restarts/controller';
import { spawn } from 'node:child_process';
import { handleRestartRequest } from '../../shared/server/restarts/http';

if (process.env.OR3_RESTART_PROCESS_FIXTURE !== 'true') throw new Error('This is an isolated journal process fixture');
const directory = process.argv[2]!;
const controller = new RestartController(directory, {
    mode: 'development', identity: 'process-fixture',
    configuration: async () => ({ revision: 'revision-1', settings: { registrationMode: 'open', allowRestart: true }, compatible: true }),
    acquire: async () => async () => {},
    async replace(operation) {
        if (process.argv[3] === 'startup-failure') {
            const child = spawn(process.execPath, ['-e', 'process.exit(42)'], { stdio: 'ignore' });
            const exitCode = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
            await appendFile(join(directory, 'executions.jsonl'), JSON.stringify({ requestId: operation.requestId, exitCode }) + '\n');
            throw new RestartError('startup_failed');
        }
        await appendFile(join(directory, 'executions.jsonl'), JSON.stringify({ requestId: operation.requestId }) + '\n');
        // Deliberately leave the acknowledgement uncertain until the process is killed.
        await new Promise(() => {});
    },
    probe: async () => {},
});
await controller.initialize();
const server = createServer(async (request, response) => {
    if (!await handleRestartRequest(controller, request, response)) { response.writeHead(404); response.end(); }
});
server.listen(join(directory, 'fixture.sock'), () => console.log('fixture-ready'));
