import { describe, it, expect } from 'vitest';
import { taskTieBreakComparator } from '../utils/sort';
import { parseModelJson } from '../utils/extractJson';
import { z } from 'zod';
import { inferLocalLabel } from '../composables/useTaskListService';
import { scoreTaskFallback } from '../composables/useTaskAiActions';

describe('task utilities', () => {
  it('uses deterministic tie-break comparator', () => {
    const sorted = [
      { id: 'b', order: 1, created_at: 2 },
      { id: 'a', order: 1, created_at: 1 },
    ].sort((a, b) => taskTieBreakComparator(a as any, b as any));

    expect(sorted[0]?.id).toBe('a');
  });

  it('extracts and validates AI JSON', () => {
    const schema = z.object({ steps: z.array(z.string()) });
    const parsed = parseModelJson('noise {"steps":["a","b"]} trailing', schema);
    expect(parsed.ok).toBe(true);
  });

  it('falls back for labels and scoring', () => {
    expect(inferLocalLabel('Schedule client meeting')).toBe('work');
    expect(inferLocalLabel('Go to gym')).toBe('health');
    expect(inferLocalLabel('Read book')).toBe('uncategorized');

    const score = scoreTaskFallback({ title: 'Refactor architecture', subtasks: [{}, {}] } as any);
    expect(score.score).toBeGreaterThan(1);
  });
});
