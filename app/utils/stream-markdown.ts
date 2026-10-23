import './stream-markdown-languages';
// Keep required math styles behind the renderer's lazy boundary, but ready
// before it mounts. Idle loading can expose unstyled formulas during a stream.
import 'katex/dist/katex.min.css';
import { WorkerCodeBlock } from './markdown/worker-code-block';

export const streamMarkdownComponents = { codeblock: WorkerCodeBlock };
export { StreamMarkdown, useShikiHighlighter } from 'streamdown-vue';
