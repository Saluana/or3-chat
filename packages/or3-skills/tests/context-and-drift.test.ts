import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { checkDocDrift } from '../scripts/check-doc-drift'
import { detectOr3Context } from '../scripts/detect-or3-context'
import { packageRoot } from '../scripts/validate-skills'

const chatRoot = resolve(packageRoot, '../..')

test('detects the OR3 Chat checkout and supported surfaces', async () => {
  const { checks, context } = await detectOr3Context(chatRoot)
  expect(checks.filter(({ level }) => level === 'error')).toEqual([])
  expect(context).toMatchObject({
    product: 'or3-chat',
    pluginRuntime: { v1Workspace: true, v2Sdk: true, cli: true },
    setup: { init: true, doctor: true, validate: true },
    theme: { create: true, validate: true, buildCss: true },
  })
})

test('current public contracts match the skill guidance', async () => {
  const { checks, root } = await checkDocDrift(chatRoot)
  expect(root).toBe(chatRoot)
  expect(checks.filter(({ level }) => level === 'error')).toEqual([])
})
