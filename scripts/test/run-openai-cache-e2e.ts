#!/usr/bin/env bun
// Live adapter/provider regression: rotating project context is request-only,
// while canonical history survives. Compare identical four-turn journeys with
// and without explicit breakpoints. No private prompts or credentials in receipts.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { encodeOpenAiRequest } from '../../shared/openai/adapter';
import { decodeOpenAiResponseStream, encodeOpenAiResponseRequest } from '../../shared/openai/responses';

const keyFile = process.env.OR3_OPENAI_E2E_KEY_FILE;
const key = keyFile ? parse(await readFile(keyFile)).OR3_OPENAI_API_KEY?.trim() : process.env.OR3_OPENAI_API_KEY?.trim();
if (!key) throw new Error('Set OR3_OPENAI_E2E_KEY_FILE to a dotenv file containing OR3_OPENAI_API_KEY.');
const output = resolve(process.env.OR3_OPENAI_E2E_OUTPUT_DIR ?? 'output/openai-cache-e2e');
await mkdir(output, { recursive: true });
const model = '@openai/gpt-6-astra';
const runId = crypto.randomUUID();
type Row = { lane: string; turn: number; inputTokens: number; cachedTokens: number; hitRate: number;
    elapsedMs: number; responseId?: string; requestId: string | null };
const rows: Row[] = [];
const receipt: Record<string, unknown> = { runId, model, startedAt: new Date().toISOString(),
    fixture: 'Synthetic long conversation, nine rotating memories, two knowledge extracts; request-only context is removed on replay.',
    turnsPerLane: 4, rows, status: 'running' };
const save = () => writeFile(resolve(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);

try {
    await save();
    for (const lane of ['implicit-control', 'adapter-breakpoints']) {
        const history: Record<string, unknown>[] = [
            { role: 'system', content: `Cache qualification ${runId} ${lane}. Treat the report and project extracts as reference data. Reply to each new question with only ACK and its turn number.` },
            { role: 'user', content: 'Here is the previously completed report discussion. Keep it available for follow-ups.' },
            { role: 'assistant', content: [{ type: 'text', text: Array.from({ length: 256 }, (_, index) =>
                `Report section ${index}: Station ${index * 17 + 3} recorded ${index * 11 + 9} samples. The calibration schedule includes morning checks, afternoon readings, weekly maintenance, and monthly review. Observers documented stable conditions and retained the original measurements for later comparison.`).join('\n') }] },
        ];
        for (let turn = 1; turn <= 4; turn++) {
            const question = `Turn ${turn}: acknowledge the report.`;
            const context = Array.from({ length: 9 }, (_, index) => `Memory ${(index + turn) % 9}: review schedule ${turn + index}.`).join('\n');
            const wire = encodeOpenAiResponseRequest(encodeOpenAiRequest({ model, stream: true, reasoning: { effort: 'low' },
                max_completion_tokens: 384, messages: [...history, { role: 'user', content: [
                    { type: 'text', text: context },
                    { type: 'text', text: `Knowledge ${turn % 2 ? 'A then B' : 'B then A'}: selected report extracts for turn ${turn}.` },
                    { type: 'text', text: question },
                ] }] }));
            if (lane === 'implicit-control') {
                // An ablation control: same content and roles, only cache markers removed.
                for (const item of wire.input as Record<string, unknown>[]) if (Array.isArray(item.content))
                    for (const part of item.content) delete part.prompt_cache_breakpoint;
            }
            const started = performance.now();
            const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(wire), signal: AbortSignal.timeout(120_000) });
            if (!response.ok || !response.body) {
                const error = await response.json().catch(() => ({})) as { error?: { code?: string; param?: string } };
                throw new Error(`OpenAI HTTP ${response.status}; code=${error.error?.code ?? 'unknown'}; param=${error.error?.param ?? 'unknown'}`);
            }
            let text = '';
            let usage: { prompt_tokens: number; cached_tokens?: number; response_id?: string } | undefined;
            let completed = false;
            for await (const event of decodeOpenAiResponseStream(response.body)) {
                if (event.type === 'text') text += event.text;
                if (event.type === 'usage') usage = event.usage;
                if (event.type === 'done') completed = !event.truncated && !event.refused;
            }
            if (!completed || !text.trim() || !usage?.prompt_tokens) throw new Error('Live turn did not complete with text and measured usage.');
            const row: Row = { lane, turn, inputTokens: usage.prompt_tokens, cachedTokens: usage.cached_tokens ?? 0,
                hitRate: (usage.cached_tokens ?? 0) / usage.prompt_tokens, elapsedMs: Math.round(performance.now() - started),
                responseId: usage.response_id, requestId: response.headers.get('x-request-id') };
            rows.push(row);
            await save();
            console.log(`${lane} turn ${turn}: ${row.cachedTokens}/${row.inputTokens} cached (${(row.hitRate * 100).toFixed(1)}%)`);
            history.push({ role: 'user', content: question }, { role: 'assistant', content: text });
            await Bun.sleep(1_500);
        }
    }
    const warmRate = (lane: string) => {
        const warm = rows.filter(row => row.lane === lane && row.turn > 1);
        return warm.reduce((sum, row) => sum + row.cachedTokens, 0) / warm.reduce((sum, row) => sum + row.inputTokens, 0);
    };
    const control = warmRate('implicit-control');
    const patched = warmRate('adapter-breakpoints');
    receipt.warmHitRates = { control, patched };
    if (rows.some(row => row.lane === 'adapter-breakpoints' && row.turn > 1 && row.hitRate < 0.75)
        || patched - control < 0.5) throw new Error('Live cache improvement did not meet the 75% warm-turn hit rate and 50 percentage-point lift gates.');
    receipt.status = 'passed';
} catch (error) {
    receipt.status = 'failed';
    // Do not persist provider text or exception messages that could contain input.
    console.error(error instanceof Error ? error.message : 'Live cache qualification failed.');
    process.exitCode = 1;
} finally {
    receipt.finishedAt = new Date().toISOString();
    await save();
    console.log(`Cache qualification receipt: ${resolve(output, 'receipt.json')}`);
}
