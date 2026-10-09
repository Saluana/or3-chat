import {
    classifyMemoryReference,
    MEMORY_DECISION_THRESHOLD,
    MEMORY_CLASSIFIER_MODEL,
    type MemoryClassificationState,
} from '../../shared/projects/memory-classification';
import { analyzeAutomaticMemory } from '../../shared/projects/automatic-memory';
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
const models = ['typesafe/jev-1.13', 'perplexity/pplx-decider-v1.1-27b'];
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
        // OR3 stores both fact and uncertain outcomes as fact; retain raw label
        // accuracy above so a conservative disagreement remains visible.
        storedKindsCorrect: cases.every(
            (row) => row.acceptedDecision === (row.expected === 'decision'),
        ),
        cases,
    });
}
// Synthetic conversations only; exercise the actual gate and extraction pipeline.
const automaticCases = [];
for (const fixture of [
    { id: 'adopted-database', text: 'For this project, we have decided to use SQLite as our database.', save: true },
    { id: 'durable-preference', text: 'For this project, always write documentation in Spanish. This is my permanent preference.', save: true },
    { id: 'one-off-question', text: 'What does the word database mean?', save: false },
    { id: 'unapproved-brainstorm', text: 'Maybe we could use Redis or SQLite someday; neither option is approved.', save: false },
]) {
    const start = Date.now();
    try {
        const result = await analyzeAutomaticMemory({
            project: { name: 'Synthetic project', brief: 'Build a web app with project-specific tooling and documentation preferences.' },
            messages: [{ id: fixture.id, role: 'user', text: fixture.text, fresh: true }],
            existing: [],
        }, key, new AbortController().signal, undefined);
        const supported = result.memories.every((memory) =>
            memory.source_message_id === fixture.id && fixture.text.includes(memory.source_quote),
        );
        automaticCases.push({ id: fixture.id, expectedSave: fixture.save,
            count: result.memories.length, passed: supported && (result.memories.length > 0) === fixture.save,
            latencyMs: Date.now() - start });
    } catch {
        automaticCases.push({ id: fixture.id, expectedSave: fixture.save,
            count: 0, passed: false, latencyMs: Date.now() - start });
    }
}
const automaticCapture = { model: MEMORY_CLASSIFIER_MODEL,
    passed: automaticCases.every((row) => row.passed), cases: automaticCases };
const path = new URL('./evaluation-results.json', import.meta.url);
await writeFile(
    path,
    JSON.stringify(
        { evaluatedAt: new Date().toISOString(), reports, automaticCapture },
        null,
        2,
    ) + '\n',
);
console.log(JSON.stringify(reports.map(({ cases, ...report }) => report)));
console.log(JSON.stringify(automaticCapture));
console.log(
    'Saved text-free receipt to planning/project-memory-classification/evaluation-results.json',
);
if (
    !reports.every(
        (report) =>
            report.complete &&
            report.storedKindsCorrect &&
            report.noFalseDecisions,
    ) || !automaticCapture.passed
)
    process.exitCode = 1;
