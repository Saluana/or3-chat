export interface DocumentationTocItem {
    id: string;
    text: string;
    level: number;
}

export function slugifyHeading(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function buildTocFromElement(
    root: HTMLElement
): { toc: DocumentationTocItem[]; headingOffsets: Record<string, number> } {
    const headings = root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
    const toc: DocumentationTocItem[] = [];
    const usedIds = new Set<string>();
    const offsets: Record<string, number> = {};

    for (const heading of headings) {
        const text = heading.textContent?.trim();
        if (!text) continue;

        let id = heading.id || slugifyHeading(text);
        if (!id) continue;

        if (usedIds.has(id)) {
            let suffix = 2;
            while (usedIds.has(`${id}-${suffix}`)) suffix += 1;
            id = `${id}-${suffix}`;
        }

        usedIds.add(id);
        heading.id = id;

        const level = Number(heading.tagName.replace('H', '')) || 1;
        toc.push({ id, text, level });
        offsets[id] = heading.offsetTop;
    }

    return { toc, headingOffsets: offsets };
}

export function getHeadingOffsets(root: HTMLElement): Record<string, number> {
    const headings = root.querySelectorAll<HTMLElement>('[id]');
    const offsets: Record<string, number> = {};
    for (const heading of headings) {
        const id = heading.id?.trim();
        if (!id) continue;
        offsets[id] = heading.offsetTop;
    }
    return offsets;
}
