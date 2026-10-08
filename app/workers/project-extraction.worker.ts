import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import { unzipSync, zipSync } from 'fflate';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const MAX_TEXT = 2 * 1024 * 1024;
const MAX_PAGES = 200;
self.onmessage = async (
    event: MessageEvent<{ bytes: ArrayBuffer; name: string }>,
) => {
    const { bytes, name } = event.data;
    let text = '';
    let partial = false;
    const locations: Array<{ label: string; start: number; end: number }> = [];
    let textBytes = 0;
    const append = (label: string, value: string) => {
        const start = text.length;
        const encoded = new TextEncoder().encode(value);
        const remaining = MAX_TEXT - textBytes;
        const bounded = new TextDecoder().decode(
            encoded.slice(0, Math.max(0, remaining)),
            { stream: encoded.length > remaining },
        );
        text += bounded;
        textBytes += new TextEncoder().encode(bounded).length;
        if (encoded.length > remaining) partial = true;
        if (locations.length < 1000)
            locations.push({ label, start, end: text.length });
    };
    try {
        if (bytes.byteLength > 20 * 1024 * 1024)
            throw new Error('Extractable uploads are limited to 20 MiB.');
        if (/\.pdf$/i.test(name)) {
            const task = pdfjs.getDocument({
                data: new Uint8Array(bytes),
                disableFontFace: true,
                useSystemFonts: true,
            });
            try {
                const document = await task.promise;
                partial = document.numPages > MAX_PAGES;
                for (
                    let pageNumber = 1;
                    pageNumber <= Math.min(document.numPages, MAX_PAGES) &&
                    textBytes < MAX_TEXT;
                    pageNumber++
                ) {
                    const page = await document.getPage(pageNumber);
                    const content = await page.getTextContent();
                    const value = content.items
                        .map((item) =>
                            'str' in item
                                ? item.str + (item.hasEOL ? '\n' : ' ')
                                : '',
                        )
                        .join('')
                        .trim();
                    if (!value) partial = true;
                    append(`Page ${pageNumber}`, value + '\n\n');
                    page.cleanup();
                }
                if (locations.length < document.numPages) partial = true;
            } finally {
                await task.destroy();
            }
            if (!text.trim())
                throw new Error('No readable text. This PDF may require OCR.');
        } else if (/\.docx$/i.test(name)) {
            // Give Mammoth a validated, bounded XML archive, never the raw upload.
            // Raw-text extraction does not need embedded media or external targets.
            let expanded = 0;
            let entries = 0;
            let hasMedia = false;
            const xml = unzipSync(new Uint8Array(bytes), {
                filter(file) {
                    if (/^word\/media\//i.test(file.name)) hasMedia = true;
                    if (++entries > 1000)
                        throw new Error(
                            'This document contains too many archive entries.',
                        );
                    expanded += file.originalSize;
                    if (expanded > 40 * 1024 * 1024)
                        throw new Error(
                            'This document expands beyond the extraction limit.',
                        );
                    return /(?:\.xml|\.rels)$/i.test(file.name);
                },
            });
            if (
                Object.values(xml).reduce(
                    (size, value) => size + value.byteLength,
                    0,
                ) >
                40 * 1024 * 1024
            )
                throw new Error(
                    'This document expands beyond the extraction limit.',
                );
            const bounded = zipSync(xml);
            const result = await mammoth.extractRawText({
                arrayBuffer: bounded.buffer.slice(
                    bounded.byteOffset,
                    bounded.byteOffset + bounded.byteLength,
                ) as ArrayBuffer,
            });
            if (!result.value.trim()) throw new Error('No readable text. This DOCX may contain images or require OCR.');
            partial = hasMedia || result.messages.some(
                (message) =>
                    message.type === 'warning' || message.type === 'error',
            );
            for (const [index, paragraph] of result.value
                .split(/\n\n/)
                .entries()) {
                if (textBytes >= MAX_TEXT) {
                    partial = true;
                    break;
                }
                append(`Paragraph ${index + 1}`, paragraph + '\n\n');
            }
        } else if (/\.(txt|md|csv)$/i.test(name)) {
            const limited = bytes.slice(0, MAX_TEXT);
            text = new TextDecoder('utf-8', { fatal: true }).decode(limited, {
                stream: bytes.byteLength > MAX_TEXT,
            });
            partial = bytes.byteLength > MAX_TEXT;
        } else
            throw new Error('Text extraction is unavailable for this format.');
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))
            throw new Error('The extracted text contains binary data.');
        self.postMessage({ ok: true, text, partial, locations });
    } catch (error) {
        self.postMessage({
            ok: false,
            error:
                error instanceof Error ? error.message : 'Extraction failed.',
        });
    }
};
