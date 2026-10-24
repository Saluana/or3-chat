import { describe, expect, it } from 'vitest';
import { cleanGeneratedTitle, documentHeading, isMeaningfulTitleInput } from '../title';

describe('title content preparation', () => {
    it.each([
        ['# OR3 Plugin Architecture\nBody', 'OR3 Plugin Architecture'],
        ['```md\n# Wrong heading\n```\n## **Nuxt** [Plugin API](https://example.test)\nBody', 'Nuxt Plugin API'],
        ['OR3 Plugin Architecture\n=======================\nBody', 'OR3 Plugin Architecture'],
        ['# Overview\n## Workspace Sync Recovery', 'Workspace Sync Recovery'],
        ['Ordinary document content.', null],
        ['# ' + 'x'.repeat(100), null],
    ])('extracts a suitable heading from %s', (content, expected) => expect(documentHeading(content)).toBe(expected));
    it.each(['Hi', 'Hello!', '你好', 'thank you', ''])('defers ambiguous chat input %s', value => expect(isMeaningfulTitleInput(value)).toBe(false));
    it.each(['Fix Nuxt hydration warnings', '修复工作区同步错误和恢复数据', 'Explain PostgreSQL indexes'])('accepts meaningful input %s', value => expect(isMeaningfulTitleInput(value)).toBe(true));
    it.each([
        ['“OR3 Plugin Architecture”', 'OR3 Plugin Architecture'],
        ['Title: Fix Nuxt Hydration.', 'Fix Nuxt Hydration'],
        ['🚀 Workspace Sync Recovery', 'Workspace Sync Recovery'],
        ['Greeting Conversation', null], ['A title\nAn explanation', null], ['', null], ['x'.repeat(81), null],
    ])('cleans or refuses provider output %s', (value, expected) => expect(cleanGeneratedTitle(value)).toBe(expected));
});
