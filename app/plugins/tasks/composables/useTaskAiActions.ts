import { z } from 'zod';
import { openRouterStream } from '~/utils/chat/openrouterStream';
import type { TaskItem, TaskLabel } from '../types';
import { parseModelJson } from '../utils/extractJson';
import { inferLocalLabel } from './useTaskListService';

const breakdownSchema = z.object({ steps: z.array(z.string()).min(1) });
const labelSchema = z.object({ label: z.enum(['work', 'home', 'health', 'uncategorized']) });
const difficultySchema = z.object({
    ratings: z.array(
        z.object({
            task_id: z.string(),
            score: z.number().min(1).max(10),
            reason: z.string(),
        })
    ),
});

async function streamToText(prompt: string): Promise<string> {
    let text = '';
    const stream = openRouterStream({
        model: 'openai/gpt-4o-mini',
        modalities: ['text'],
        orMessages: [
            { role: 'system', content: 'Return concise JSON only. No markdown.' },
            { role: 'user', content: prompt },
        ],
    });
    for await (const event of stream) {
        if (event.type === 'text') text += event.text;
    }
    return text;
}

export function scoreTaskFallback(task: TaskItem): { score: number; reason: string } {
    let score = 1;
    score += Math.min(4, Math.floor(task.title.length / 24));
    score += Math.min(2, task.subtasks.length);
    if (/refactor|migrate|architecture|incident|urgent/i.test(task.title)) score += 2;
    if (/quick|tiny|buy|email/i.test(task.title)) score -= 1;
    score = Math.min(10, Math.max(1, score));
    return { score, reason: 'Fallback heuristic (title length, keywords, subtasks).' };
}

export function useTaskAiActions() {
    async function breakTaskDown(input: {
        title: string;
        notes?: string;
        count?: number;
    }): Promise<{ ok: true; steps: string[] } | { ok: false; error: string }> {
        const count = input.count ?? 5;
        try {
            const response = await streamToText(
                `Break this task into exactly ${count} short actionable steps. Task: ${input.title}. Notes: ${input.notes ?? ''}. Response JSON: {"steps": ["..."]}`
            );
            const parsed = parseModelJson(response, breakdownSchema);
            if (!parsed.ok) return { ok: false, error: parsed.error };
            const steps = parsed.data.steps
                .map((step) => step.trim())
                .filter(Boolean)
                .slice(0, count);
            if (steps.length === 0) return { ok: false, error: 'No steps returned by model' };
            while (steps.length < count) steps.push(`Step ${steps.length + 1}`);
            return { ok: true, steps };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : 'AI request failed' };
        }
    }

    async function autoLabelTask(input: {
        title: string;
        manualOverride: boolean;
    }): Promise<{ label: TaskLabel; source: 'ai' | 'fallback' | 'manual-preserved' }> {
        if (input.manualOverride) {
            return { label: 'uncategorized', source: 'manual-preserved' };
        }
        try {
            const response = await streamToText(
                `Classify task into one label: work, home, health, uncategorized. Task: ${input.title}. Return JSON: {"label":"..."}`
            );
            const parsed = parseModelJson(response, labelSchema);
            if (!parsed.ok) return { label: inferLocalLabel(input.title), source: 'fallback' };
            return { label: parsed.data.label, source: 'ai' };
        } catch {
            return { label: inferLocalLabel(input.title), source: 'fallback' };
        }
    }

    async function analyzeDifficulty(tasks: TaskItem[]) {
        try {
            const payload = tasks.map((task) => ({ id: task.id, title: task.title, subtasks: task.subtasks.length }));
            const response = await streamToText(
                `Score each task from 1-10 by difficulty and give a short reason. Tasks: ${JSON.stringify(payload)}. Return JSON: {"ratings":[{"task_id":"...","score":1,"reason":"..."}]}`
            );
            const parsed = parseModelJson(response, difficultySchema);
            if (!parsed.ok) throw new Error(parsed.error);
            return { ok: true as const, ratings: parsed.data.ratings, fallbackNotice: null };
        } catch {
            return {
                ok: true as const,
                ratings: tasks.map((task) => ({ task_id: task.id, ...scoreTaskFallback(task) })),
                fallbackNotice: 'AI difficulty unavailable, using deterministic local fallback.',
            };
        }
    }

    return { breakTaskDown, autoLabelTask, analyzeDifficulty };
}
