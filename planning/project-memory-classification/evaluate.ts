import {
    classifyMemoryReference,
    MEMORY_DECISION_THRESHOLD,
    type MemoryClassificationState,
} from '../../shared/projects/memory-classification';
import { readFile, writeFile } from 'node:fs/promises';

// Explicit qualification command only. Never called by the app; prints no state or credentials.
const key = process.env.OPENROUTER_API_KEY;
if (!key)
    throw new Error(
        'Set OPENROUTER_API_KEY for this bounded paid qualification run.',
    );
const fixtures = JSON.parse(await readFile(
    new URL('./fixtures.json', import.meta.url), 'utf8',
)) as Array<{ id: string; expected: 'fact' | 'decision' | 'uncertain'; state: MemoryClassificationState }>;
const models = ['openai/gpt-6-luna-decisions', 'typesafe/jev-1.13'];
const reports = [];
for (const model of models) {
    const cases = [];
    for (const fixture of fixtures) {
        const result = await classifyMemoryReference(
            fixture.state,
            key,
            new AbortController().signal,
            undefined,
            undefined,
            model,
        );
        const probabilities = result.probabilities;
        const predicted = probabilities
            ? Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0]
            : 'unavailable';
        cases.push({
            id: fixture.id,
            expected: fixture.expected,
            predicted,
            acceptedDecision: result.kind === 'decision',
            probabilities,
            latencyMs: result.latencyMs,
            cost: result.cost,
        });
    }
    reports.push({
        model,
        threshold: MEMORY_DECISION_THRESHOLD,
        clearCasesCorrect: cases
            .filter((row) => row.expected !== 'uncertain')
            .every(
                (row) =>
                    row.predicted === row.expected &&
                    (row.expected !== 'decision' || row.acceptedDecision),
            ),
        noFalseDecisions: cases
            .filter((row) => row.expected !== 'decision')
            .every((row) => !row.acceptedDecision),
        complete: cases.every((row) => row.predicted !== 'unavailable'),
        cases,
    });
}
const path = new URL('./evaluation-results.json', import.meta.url);
await writeFile(
    path,
    JSON.stringify(
        { evaluatedAt: new Date().toISOString(), reports },
        null,
        2,
    ) + '\n',
);
console.log(JSON.stringify(reports.map(({ cases, ...report }) => report)));
console.log(
    'Saved text-free receipt to planning/project-memory-classification/evaluation-results.json',
);
if (
    !reports.some(
        (report) =>
            report.complete &&
            report.clearCasesCorrect &&
            report.noFalseDecisions,
    )
)
    process.exitCode = 1;
