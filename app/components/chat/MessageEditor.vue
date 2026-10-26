<template>
    <div
        v-bind="containerProps"
        :class="[
            'message-editor-container relative min-h-[40px]',
            containerProps?.class ?? '',
        ]"
    >
        <EditorContent
            v-if="editor"
            v-bind="editorProps"
            :class="['tiptap-editor fade-in', editorProps?.class ?? '']"
            :editor="(editor as any)"
        />
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { Node } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Editor, EditorContent } from '@tiptap/vue-3';
// If you still want markdown extension keep it; otherwise remove these two lines:
import { Markdown } from 'tiptap-markdown';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const props = defineProps<{
    modelValue: string;
    autofocus?: boolean;
    focusDelay?: number;
}>();
const emit = defineEmits<{
    (e: 'update:modelValue', v: string): void;
    (e: 'ready'): void;
    (e: 'submit'): void;
    (e: 'cancel'): void;
}>();

const containerProps = useThemeOverrides({
    component: 'div',
    context: 'message',
    identifier: 'message.editor-container',
    isNuxtUI: false,
});

const editorProps = useThemeOverrides({
    component: 'div',
    context: 'message',
    identifier: 'message.editor',
    isNuxtUI: false,
});

const editor = ref<Editor | null>(null);
let lastEmitted = '';

// Chat rendering treats escaped brackets as math delimiters. Encode literal
// brackets as entities so saving cannot turn them into math or Markdown links.
type MarkdownState = { esc(str: string, startOfLine?: boolean): string; text(text: string, escape?: boolean): void };
const MessageText = Node.create({
    name: 'text',
    group: 'inline',
    addStorage() {
        return {
            markdown: {
                serialize(state: MarkdownState, node: { text: string }) {
                    const esc = state.esc;
                    state.esc = (str, startOfLine) => esc.call(state, str, startOfLine)
                        .replace(/\\\[/g, '&#91;').replace(/\\\]/g, '&#93;');
                    try { state.text(node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')); }
                    finally { state.esc = esc; }
                },
            },
        };
    },
});

type MathToken = { content: string; markup: string };
type MathInlineState = { src: string; pos: number; posMax: number; push(type: string, tag: string, nesting: 0): MathToken };
type MathMarkdownParser = {
    inline: { ruler: { before(before: string, name: string, rule: (state: MathInlineState, silent: boolean) => boolean): void } };
    renderer: { rules: Record<string, (tokens: MathToken[], index: number) => string> };
    utils: { escapeHtml(text: string): string };
};
// Keep genuine LaTeX spans distinct from literal brackets, including in mixed
// messages. Code spans/fences are consumed by markdown-it before this rule.
const MessageMath = Node.create({
    name: 'messageMath',
    inline: true,
    group: 'inline',
    content: 'text*',
    marks: '',
    addAttributes: () => ({ delimiter: { default: 'display' } }),
    parseHTML: () => [{ tag: 'span[data-message-math]', preserveWhitespace: 'full',
        getAttrs: element => ({ delimiter: element.getAttribute('data-message-math') }) }],
    renderHTML: ({ node }) => ['span', { 'data-message-math': node.attrs.delimiter }, 0],
    renderText: ({ node }) => node.attrs.delimiter === 'inline'
        ? `\\(${node.textContent}\\)` : `\\[${node.textContent}\\]`,
    addStorage() {
        return { markdown: {
            serialize(state: MarkdownState, node: { attrs: { delimiter: string }; textContent: string }) {
                const [open, close] = node.attrs.delimiter === 'inline' ? ['\\(', '\\)'] : ['\\[', '\\]'];
                state.text(open + node.textContent + close, false);
            },
            parse: { setup(parser: MathMarkdownParser) {
                parser.inline.ruler.before('escape', 'or3_message_math', (state, silent) => {
                    for (const [open, close, delimiter] of [['\\[', '\\]', 'display'], ['\\(', '\\)', 'inline']] as const) {
                        if (!state.src.startsWith(open, state.pos)) continue;
                        const start = state.pos + open.length;
                        const end = state.src.indexOf(close, start);
                        if (end < 0 || end + close.length > state.posMax) continue;
                        const content = state.src.slice(start, end);
                        if (!content.trim() || content.includes('`')) continue;
                        if (!silent) {
                            const token = state.push('or3_message_math', '', 0);
                            token.content = content;
                            token.markup = delimiter;
                        }
                        state.pos = end + close.length;
                        return true;
                    }
                    return false;
                });
                parser.renderer.rules.or3_message_math = (tokens, index) => {
                    const token = tokens[index]!;
                    return `<span data-message-math="${token.markup}">${parser.utils.escapeHtml(token.content)}</span>`;
                } },
            },
        } };
    },
});
let emitTimer: ReturnType<typeof setTimeout> | undefined;
let pendingValue: string | undefined;

function cancelPendingEmit(): void {
    if (emitTimer === undefined) return;
    clearTimeout(emitTimer);
    emitTimer = undefined;
    pendingValue = undefined;
}

function emitModelValue(val: string): void {
    cancelPendingEmit();
    pendingValue = val;
    emitTimer = setTimeout(flushPendingEmit, 200);
}

// Push the debounced value out now so a save started right after typing
// (button click or shortcut) never misses the last keystrokes.
function flushPendingEmit(): void {
    if (emitTimer !== undefined) clearTimeout(emitTimer);
    emitTimer = undefined;
    if (pendingValue === undefined) return;
    const val = pendingValue;
    pendingValue = undefined;
    lastEmitted = val;
    emit('update:modelValue', val);
}

async function init() {
    const extensions = [StarterKit.configure({ codeBlock: {}, text: false }), MessageText, MessageMath, Markdown];

    function hasGetMarkdown(v: unknown): v is { getMarkdown: () => string } {
        if (v === null || typeof v !== 'object') return false;
        if (!('getMarkdown' in v)) return false;
        const fn = (v as Record<string, unknown>).getMarkdown;
        return typeof fn === 'function';
    }

    const instance = new Editor({
        extensions,
        content: props.modelValue,
        editorProps: {
            // Escape cancels, Ctrl/Cmd+Enter saves (plain Enter stays a newline).
            handleKeyDown: (_view, event) => {
                if (event.isComposing) return false;
                if (event.key === 'Escape') {
                    cancelPendingEmit();
                    emit('cancel');
                    return true;
                }
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    flushPendingEmit();
                    emit('submit');
                    return true;
                }
                return false;
            },
        },
        onBlur: () => flushPendingEmit(),
        onUpdate: ({ editor: e }) => {
            const storage: unknown = e.storage;
            if (
                storage &&
                typeof storage === 'object' &&
                'markdown' in storage
            ) {
                const markdown = (storage as Record<string, unknown>).markdown;
                if (hasGetMarkdown(markdown)) {
                    emitModelValue(markdown.getMarkdown());
                }
            }
        },
    });

    editor.value = instance;

    await nextTick();
    if (props.autofocus) {
        const delay =
            typeof props.focusDelay === 'number' ? props.focusDelay : 90;
        setTimeout(() => {
            try {
                instance.commands.focus('end');
            } catch {}
        }, delay);
    }
    lastEmitted = props.modelValue;
    emit('ready');
}

onMounted(() => {
    init();
});

onBeforeUnmount(() => {
    cancelPendingEmit();
    try {
        editor.value?.destroy();
    } catch {}
});

watch(
    () => props.modelValue,
    (val) => {
        const instance = editor.value;
        if (!instance || val === lastEmitted) return;

        // A parent replacement is authoritative. Drop any queued local update
        // so it cannot overwrite the newer value after the debounce expires.
        cancelPendingEmit();
        instance.commands.setContent(val, { emitUpdate: false });
        lastEmitted = val;
    }
);
</script>

<style scoped>
.tiptap-editor {
    min-height: 40px;
    outline: none;
    font: inherit;
}
.message-editor-container {
    border-radius: var(--md-border-radius-small, var(--md-border-radius));
}
.message-editor-container:focus-within {
    outline: var(--app-focus-ring-width, 2px) solid
        var(--md-focus-ring, var(--md-primary));
    /* Sit the ring outside the text (the bubble has room) without shifting layout. */
    outline-offset: 6px;
}
.tiptap-editor :deep(p) {
    margin: 0 0 0.5rem;
}
.tiptap-editor :deep(p:last-child) {
    margin-bottom: 0;
}
.tiptap-editor :deep(pre) {
    background: var(--md-surface-container-lowest);
    padding: 0.5rem;
    border: var(--md-border-width-subtle, var(--md-border-width)) solid var(--md-outline);
}
.tiptap-editor :deep(.ProseMirror) {
    outline: none;
}
.fade-in {
    opacity: 0;
    animation: fadeInEditor var(--app-motion-duration-fast, 0.14s)
        var(--app-motion-easing-standard, ease-out) forwards;
}
@keyframes fadeInEditor {
    to {
        opacity: 1;
    }
}
</style>
