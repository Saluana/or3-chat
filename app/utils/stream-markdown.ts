import './stream-markdown-languages';
import { WorkerCodeBlock } from './markdown/worker-code-block';

export const streamMarkdownComponents = { codeblock: WorkerCodeBlock };
export { StreamMarkdown, useShikiHighlighter } from 'streamdown-vue';
