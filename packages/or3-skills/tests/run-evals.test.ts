import { expect, test } from 'bun:test'
import { validateEvaluationFixtures } from '../scripts/run-evals'
import { packageRoot } from '../scripts/validate-skills'

test('the routing and completion fixture corpus is internally consistent', async () => {
  const result = await validateEvaluationFixtures(packageRoot)
  expect(result.checks.filter(({ level }) => level === 'error')).toEqual([])
  expect(result.routingCases).toBeGreaterThanOrEqual(8)
  expect(result.completionCases).toBeGreaterThanOrEqual(2)
})
