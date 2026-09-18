import { describe, expect, it } from 'vitest'
import {
    buildPluginModelCatalog,
    parseAllowedModels,
    parseModelPrices,
} from '../../shared/plugins/ai/model-catalog'

/**
 * Phase 9 (R8.AC5, task 9.1): the host's approved plugin models are operator
 * configuration parsed strictly, so a typo cannot widen the allowlist and an
 * unpriced model is refused rather than recorded as free.
 */
describe('plugin model catalog', () => {
    it('parses a comma-separated allowlist and drops junk and duplicates', () => {
        expect(parseAllowedModels('vendor/alpha, vendor/beta ,vendor/alpha,,not a model')).toEqual([
            'vendor/alpha',
            'vendor/beta',
        ])
        expect(parseAllowedModels(undefined)).toEqual([])
        expect(parseAllowedModels(['vendor/alpha', 42, ''])).toEqual(['vendor/alpha'])
        expect(parseAllowedModels('../etc/passwd')).toEqual([])
    })

    it('accepts only finite nonnegative prices from JSON', () => {
        expect(
            parseModelPrices('{"vendor/alpha":{"promptPerMillion":3,"completionPerMillion":15}}'),
        ).toEqual({ 'vendor/alpha': { promptPerMillion: 3, completionPerMillion: 15 } })
        expect(parseModelPrices('{"vendor/alpha":{"promptPerMillion":-1,"completionPerMillion":15}}')).toEqual({})
        expect(parseModelPrices('{"vendor/alpha":{"promptPerMillion":"free","completionPerMillion":15}}')).toEqual({})
        expect(parseModelPrices('not json')).toEqual({})
        expect(parseModelPrices('')).toEqual({})
    })

    it('reports priced and unpriced models with the enforced limits', () => {
        const catalog = buildPluginModelCatalog({
            allowed: 'vendor/alpha,vendor/beta',
            prices: { 'vendor/alpha': { promptPerMillion: 3, completionPerMillion: 15 } },
        })
        expect(catalog.configured).toBe(true)
        expect(catalog.models).toEqual([
            {
                id: 'vendor/alpha',
                label: 'alpha',
                priced: true,
                promptPerMillion: 3,
                completionPerMillion: 15,
            },
            {
                id: 'vendor/beta',
                label: 'beta',
                priced: false,
                promptPerMillion: null,
                completionPerMillion: null,
            },
        ])
        expect(catalog.limits.maxOutputTokens).toBeGreaterThan(0)
        expect(catalog.limits.spendLimitUsd).toBeGreaterThan(0)
    })

    it('reports an unconfigured host explicitly', () => {
        const catalog = buildPluginModelCatalog({ allowed: '', prices: {} })
        expect(catalog.configured).toBe(false)
        expect(catalog.models).toEqual([])
    })
})
