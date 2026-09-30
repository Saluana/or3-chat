import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findMissingDeclaredSample } from '../../packages/plugin-sdk/src/cli/shared'

/**
 * Phase 9 review: a declared first-action sample must ship in the package, so the
 * packer and the validator refuse a package that would fail at run time.
 */
describe('declared first-action sample', () => {
    function fixture(setup: unknown, files: readonly string[]): { root: string; cleanup: () => void } {
        const root = mkdtempSync(join(tmpdir(), 'or3-sample-'))
        mkdirSync(join(root, 'fixtures'), { recursive: true })
        writeFileSync(join(root, 'or3.setup.json'), JSON.stringify(setup), 'utf8')
        for (const file of files) writeFileSync(join(root, file), 'x', 'utf8')
        return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
    }

    it('accepts a declared sample that is packaged', () => {
        const { root, cleanup } = fixture(
            {
                setupVersion: 1,
                settingsSchemaPath: 'settings.schema.json',
                fields: [],
                connections: [],
                firstAction: { operationId: 'documents.write', label: 'Run', usesSampleContext: true, samplePath: 'fixtures/sample.md' },
            },
            ['fixtures/sample.md'],
        )
        try {
            expect(findMissingDeclaredSample({ packRoot: root, files: ['fixtures/sample.md'] })).toBeNull()
        } finally {
            cleanup()
        }
    })

    it('reports a declared sample that was not packaged', () => {
        const { root, cleanup } = fixture(
            {
                setupVersion: 1,
                settingsSchemaPath: 'settings.schema.json',
                fields: [],
                connections: [],
                firstAction: { operationId: 'documents.write', label: 'Run', usesSampleContext: true, samplePath: 'fixtures/ghost.md' },
            },
            [],
        )
        try {
            expect(findMissingDeclaredSample({ packRoot: root, files: ['fixtures/sample.md'] })).toBe('fixtures/ghost.md')
        } finally {
            cleanup()
        }
    })

    it('ignores packages without a sample declaration', () => {
        const { root, cleanup } = fixture(
            {
                setupVersion: 1,
                settingsSchemaPath: 'settings.schema.json',
                fields: [],
                connections: [],
                firstAction: { operationId: 'documents.write', label: 'Run', usesSampleContext: false },
            },
            [],
        )
        try {
            expect(findMissingDeclaredSample({ packRoot: root, files: [] })).toBeNull()
        } finally {
            cleanup()
        }
    })
})
