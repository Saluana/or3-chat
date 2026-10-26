import { expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('~/db/files', () => ({ getFileBlob: storage.read }));
import { documentToMarkdown } from '../document-to-markdown';
const content = { type: 'doc', content: [{ type: 'or3Image', attrs: { hash: 'saved-image', alt: 'A <photo>', width: 50 } }] };
it.each([
    ['left', 'margin-left:0;margin-right:auto'],
    ['center', 'margin-left:auto;margin-right:auto'],
    ['right', 'margin-left:auto;margin-right:0'],
])('exports actual image bytes and %s alignment in the document download', async (align, margins) => {
    storage.read.mockResolvedValueOnce(new Blob(['image-bytes'], { type: 'image/png' }));
    const result = await documentToMarkdown({ ...content, content: [{ ...content.content[0]!, attrs: { ...content.content[0]!.attrs, align } }] });
    expect(result).toContain('data:image/png;base64,aW1hZ2UtYnl0ZXM=');
    expect(result).toContain('A &lt;photo&gt;');
    expect(result).toContain('width:50%');
    expect(result).toContain(margins);
});
it('refuses an incomplete export when a referenced image is unavailable', async () => {
    storage.read.mockResolvedValueOnce(null);
    await expect(documentToMarkdown(content)).rejects.toThrow();
});
