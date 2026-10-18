import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateEvaluationFixtures } from '../scripts/run-evals'
import { packageRoot } from '../scripts/validate-skills'

test('the routing and completion fixture corpus is internally consistent', async () => {
  const result = await validateEvaluationFixtures(packageRoot)
  expect(result.checks.filter(({ level }) => level === 'error')).toEqual([])
  expect(result.routingCases).toBeGreaterThanOrEqual(8)
  expect(result.completionCases).toBeGreaterThanOrEqual(2)
})

test.each([
  { evidence: ['result', 'validation'], valid: true },
  { evidence: ['validation', 'artifactStatus', 'result', 'permissions'], valid: true },
  { evidence: ['result'], valid: false },
  { evidence: ['validation'], valid: false },
  { evidence: ['result', 'validation', ''], valid: false },
])('completion evidence $evidence is accepted: $valid', async ({ evidence, valid }) => {
  const root = await mkdtemp(join(tmpdir(), 'or3-skill-evidence-'))
  try {
    const fixtures = join(root, 'tests/fixtures')
    await mkdir(fixtures, { recursive: true })
    await Bun.write(join(fixtures, 'routing-cases.json'), '[]')
    await Bun.write(join(fixtures, 'completion-cases.json'), JSON.stringify([
      { id: 'task-specific-report', requiredEvidence: evidence },
    ]))
    const result = await validateEvaluationFixtures(root)
    expect(result.checks.some(({ level }) => level === 'error')).toBe(!valid)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
