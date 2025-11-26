import { Extension, Editor } from '@tiptap/core';
import { Plugin, PluginKey, EditorState, Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { useDebounceFn } from '@vueuse/core';
import { state, isMobile } from '~/state/global';
import AutocompleteState from './state';
import { createOpenRouterClient, getRequestOptions } from '../../../shared/openrouter/client';
import { normalizeSDKError } from '../../../shared/openrouter/errors';

interface AutocompletePluginState {
    suggestion: string;
    loading: boolean;
    recentlyBackspace: boolean;
}

async function editorAutoComplete(content: string, abortSignal?: AbortSignal) {
    const orKey =
        state.value.openrouterKey ||
        localStorage.getItem('openrouter_api_key') ||
        '';

    if (!orKey) {
        throw new Error('OpenRouter API key not found');
    }

    const { default: systemPrompt } = await import('./AutocompletePrompt');
    const prompt = systemPrompt(content);

    const client = createOpenRouterClient({ apiKey: orKey });

    try {
        const completion = await client.chat.send(
            {
                model: AutocompleteState.value.aiModel || 'openai/gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: prompt,
                    },
                    {
                        role: 'user',
                        content,
                    },
                ],
            },
            getRequestOptions(abortSignal)
        );

        // SDK returns ChatResponse with choices array
        const generatedText = completion.choices?.[0]?.message?.content || '';

        let parsedCompletion = '';

        // Try to match with closing tag first
        let match = /<next_line>(.*?)<\/next_line>/s.exec(generatedText);

        // If no closing tag, try to match just the opening tag and take everything after it
        if (!match) {
            match = /<next_line>(.+)/s.exec(generatedText);
        }

        if (match && match[1]) {
            // Don't trim! The AI handles spacing based on the prompt instructions
            parsedCompletion = match[1];
        }

        if (!parsedCompletion || parsedCompletion.length === 0) {
            return { completion: '' };
        }

        return { completion: parsedCompletion };
    } catch (error) {
        const normalized = normalizeSDKError(error);

        if (normalized.code === 'ERR_ABORTED') {
            throw error; // Re-throw AbortError for existing handling
        }

        throw new Error(normalized.message);
    }
}

const pluginKey = new PluginKey<AutocompletePluginState>('autocomplete');

function getContextWithCursor(state: EditorState): string {
    const { selection, doc } = state;

    if (doc.content.size === 0 || !selection.$anchor) {
        return '<cursor-position />';
    }

    const MAX_CHARS = 1000;
    const start = Math.max(0, selection.from - MAX_CHARS);
    const end = Math.min(doc.content.size, selection.from + MAX_CHARS);

    const before = doc.textBetween(start, selection.from, '\n');
    const after = doc.textBetween(selection.from, end, '\n');

    return `${before}<cursor-position />${after}`;
}

export const AutocompleteExtension = Extension.create<{}>({
    name: 'autocomplete',

    addProseMirrorPlugins() {
        let editorView: EditorView | null = null;
        let abortController: AbortController | null = null;
        // Unique requestId for each fetch to guard against race conditions
        let requestId = 0;
        // Store the context and selection used for the latest fetch
        let lastFetchContext: string | null = null;
        let lastFetchSelection: { from: number; to: number } | null = null;
        // Loading timeout to prevent stuck loading state
        let loadingTimeoutId: number | null = null;
        // Last typing time for smart debounce
        const lastTypingTime = 0;

        // Helper function to abort current request and cancel debounce
        function abortCurrentRequest() {
            if (abortController) {
                abortController.abort();
                abortController = null;
            }
        }

        // Helper function to dispatch state updates in batch
        function dispatchStateUpdate(
            view: EditorView,
            updates: Record<string, any>
        ) {
            if (!view || view.isDestroyed) return;

            const tr = view.state.tr;
            Object.entries(updates).forEach(([key, value]) => {
                tr.setMeta(key, value);
            });
            view.dispatch(tr);
        }

        // Helper function for better focus handling
        function ensureFocus(view: EditorView) {
            if (!view || view.isDestroyed) return;

            requestAnimationFrame(() => {
                if (document.activeElement !== view.dom) {
                    view.focus();
                }
            });
        }

        // Start loading timeout to prevent stuck loading states
        function startLoadingTimeout() {
            // Clear any existing timeout first
            if (loadingTimeoutId !== null) {
                clearTimeout(loadingTimeoutId);
            }

            // Set new timeout
            loadingTimeoutId = window.setTimeout(() => {
                if (editorView && !editorView.isDestroyed) {
                    const state = pluginKey.getState(editorView.state);
                    if (state?.loading) {
                        dispatchStateUpdate(editorView, { loading: false });
                    }
                }
                loadingTimeoutId = null;
            }, 5000); // 5 second timeout
        }

        // Use standard debounce for initial setup
        const debouncedFetchAndDispatch = useDebounceFn(async () => {
            // Check if autocomplete is enabled
            if (!AutocompleteState.value.isEnabled) {
                return;
            }

            if (!editorView) {
                return;
            }

            const latestState = pluginKey.getState(editorView.state);

            if (latestState?.recentlyBackspace) {
                // Ensure loading is false if we skip here and it was somehow true
                if (latestState.loading) {
                    dispatchStateUpdate(editorView, { loading: false });
                }
                return;
            }

            // IMPORTANT: Skip if already loading to prevent concurrent fetches
            if (latestState?.loading) {
                return;
            }

            const viewAtStart = editorView;
            if (!viewAtStart || viewAtStart.isDestroyed) {
                return;
            }

            // Capture context and selection snapshot before fetch
            const contextWithCursor = getContextWithCursor(viewAtStart.state);
            const selection = viewAtStart.state.selection;
            lastFetchContext = contextWithCursor;
            lastFetchSelection = { from: selection.from, to: selection.to };

            // Use the helper function to abort current request
            abortCurrentRequest();

            abortController = new AbortController();
            const signal = abortController.signal;
            // Increment requestId for each fetch
            requestId++;
            const thisRequestId = requestId;

            // Set loading: true in plugin state before starting fetch
            // Only set loading if the view is still valid
            const currentLoadingState = pluginKey.getState(
                viewAtStart.state
            )?.loading;

            if (
                viewAtStart &&
                !viewAtStart.isDestroyed &&
                currentLoadingState === false
            ) {
                dispatchStateUpdate(viewAtStart, { loading: true });
                // Start loading timeout
                startLoadingTimeout();
            }

            // (Moved contextWithCursor logic above)
            let apiSuggestion: string | null = null;
            try {
                const response = await editorAutoComplete(
                    contextWithCursor,
                    signal
                );
                apiSuggestion = response?.completion ?? null;
            } catch (error: any) {
                if (error?.name === 'AbortError') {
                    if (viewAtStart && !viewAtStart.isDestroyed) {
                        dispatchStateUpdate(viewAtStart, {
                            suggestionCleared: true,
                        });
                    }
                    return;
                }
                console.error('API call failed', error);
                apiSuggestion = null;
            } finally {
                // Check view validity AGAIN after await, before any potential dispatch
                if (!viewAtStart || viewAtStart.isDestroyed) {
                    // Reset local abortController if it wasn't used or if it's the one we created
                    if (abortController && abortController.signal === signal) {
                        abortController = null;
                    }
                    return; // Don't dispatch anything if view is gone
                }

                // Reset local abortController only if the fetch completed (not aborted)
                if (
                    abortController &&
                    abortController.signal === signal &&
                    !signal.aborted
                ) {
                    abortController = null;
                }
            }

            // Only dispatch if this is the latest request AND context/selection match
            if (thisRequestId === requestId) {
                const currentContext = getContextWithCursor(viewAtStart.state);
                const currentSelection = viewAtStart.state.selection;
                const contextMatches = currentContext === lastFetchContext;
                const selectionMatches =
                    lastFetchSelection &&
                    currentSelection.from === lastFetchSelection.from &&
                    currentSelection.to === lastFetchSelection.to;

                if (contextMatches && selectionMatches) {
                    if (viewAtStart && !viewAtStart.isDestroyed) {
                        dispatchStateUpdate(viewAtStart, {
                            suggestionFromAPI: apiSuggestion,
                        });
                    }
                } else {
                    // Always clear loading if fetch result is stale
                    if (viewAtStart && !viewAtStart.isDestroyed) {
                        dispatchStateUpdate(viewAtStart, {
                            suggestionCleared: true,
                            loading: false,
                        });
                    }
                }
            } else {
                // Also clear loading state if the request ID is stale
                if (viewAtStart && !viewAtStart.isDestroyed) {
                    const tr = viewAtStart.state.tr
                        .setMeta('suggestionCleared', true)
                        .setMeta('loading', false);
                    viewAtStart.dispatch(tr);
                }
            }
        }, 600);

        return [
            new Plugin<AutocompletePluginState>({
                key: pluginKey,
                view(view) {
                    editorView = view;

                    const handleKeyDown = (event: KeyboardEvent) => {
                        if (event.key === 'Tab') {
                            const pluginState = pluginKey.getState(view.state);
                            if (
                                pluginState?.suggestion &&
                                !pluginState.loading
                            ) {
                                event.preventDefault(); // Stop default behavior
                                event.stopPropagation(); // Stop event bubbling
                                const { from } = view.state.selection;
                                const $from = view.state.selection.$from;
                                const atNodeStart = $from.parentOffset === 0;

                                // Check if character before cursor is a space
                                const charBefore = view.state.doc.textBetween(
                                    from - 1,
                                    from,
                                    ''
                                );
                                const hasSpaceBefore = charBefore === ' ';

                                // Determine text to insert
                                let textToInsert = pluginState.suggestion;

                                // Trim leading space if we're at node start OR if there's already a space before cursor
                                if (
                                    (atNodeStart || hasSpaceBefore) &&
                                    textToInsert.startsWith(' ')
                                ) {
                                    textToInsert = textToInsert.trimStart();
                                }

                                const tr = view.state.tr
                                    .insertText(textToInsert, from)
                                    .setMeta('suggestionAccepted', true);
                                view.dispatch(tr);
                                // Use improved focus handling
                                ensureFocus(view);
                                return true;
                            }
                        }

                        // Clear suggestions on arrow key navigation (don't block the event)
                        if (
                            event.key === 'ArrowLeft' ||
                            event.key === 'ArrowRight' ||
                            event.key === 'ArrowUp' ||
                            event.key === 'ArrowDown'
                        ) {
                            const pluginState = pluginKey.getState(view.state);
                            if (
                                pluginState?.suggestion ||
                                pluginState?.loading
                            ) {
                                // Clear suggestions but let the arrow key event through for navigation
                                dispatchStateUpdate(view, {
                                    suggestionCleared: true,
                                    loading: false,
                                });
                            }
                            // Don't prevent default - let TipTap handle arrow key navigation
                        }
                        // REMOVED Backspace handling from here. It's handled in addKeyboardShortcuts.
                    };

                    // Only use capture for Tab key, otherwise use normal phase
                    // This prevents interference with arrow key navigation
                    view.dom.addEventListener('keydown', handleKeyDown);

                    // Named focus/blur handlers for proper cleanup
                    function handleBlur() {
                        // Use helper to abort current request
                        abortCurrentRequest();
                        // On blur, clear suggestions and loading state
                        const pluginState = pluginKey.getState(view.state);
                        if (
                            (pluginState?.suggestion &&
                                pluginState.suggestion.length > 0) ||
                            pluginState?.loading
                        ) {
                            dispatchStateUpdate(view, {
                                suggestionCleared: true,
                                loading: false,
                            });
                        }
                    }
                    function handleFocus() {}
                    view.dom.addEventListener('blur', handleBlur);
                    view.dom.addEventListener('focus', handleFocus);

                    return {
                        update(view, prevState) {
                            if (editorView !== view) {
                                editorView = view;
                            }
                        },
                        destroy() {
                            // Clear any loading timeout
                            if (loadingTimeoutId !== null) {
                                clearTimeout(loadingTimeoutId);
                                loadingTimeoutId = null;
                            }

                            // Use helper to abort current request
                            abortCurrentRequest();
                            view.dom.removeEventListener(
                                'keydown',
                                handleKeyDown
                            );
                            view.dom.removeEventListener('blur', handleBlur);
                            view.dom.removeEventListener('focus', handleFocus);
                            editorView = null;
                        },
                    };
                },

                state: {
                    init(): AutocompletePluginState {
                        return {
                            suggestion: '',
                            loading: false,
                            recentlyBackspace: false,
                        };
                    },
                    apply(
                        tr: Transaction,
                        value: AutocompletePluginState,
                        oldState: EditorState,
                        newState: EditorState
                    ): AutocompletePluginState {
                        // Don't make suggestions if the editor is empty
                        if (tr.doc.content.size <= 2) {
                            // size is 2 for an empty paragraph
                            return {
                                suggestion: '',
                                loading: false,
                                recentlyBackspace: false,
                            };
                        }

                        const suggestionCleared =
                            tr.getMeta('suggestionCleared');
                        const suggestionAccepted =
                            tr.getMeta('suggestionAccepted');
                        const suggestionSet = tr.getMeta('suggestionSet') as
                            | string
                            | undefined;
                        const suggestionFromAPI = tr.getMeta(
                            'suggestionFromAPI'
                        ) as string | undefined | null;
                        const lastKeyBackspace = tr.getMeta('lastKeyBackspace');
                        const loadingMeta = tr.getMeta('loading');

                        // Default next state to current value, we'll override if needed
                        let nextState = { ...value };

                        // Handle loading meta
                        if (loadingMeta === true) {
                            nextState = {
                                ...nextState,
                                loading: true,
                                recentlyBackspace: false,
                            };
                        }

                        // Handle Backspace: Clear state and set recentlyBackspace flag
                        if (lastKeyBackspace) {
                            // Use helper to abort current request
                            abortCurrentRequest();
                            // Set flag, clear suggestion/loading
                            nextState = {
                                suggestion: '',
                                loading: false,
                                recentlyBackspace: true,
                            };
                            // We return nextState at the end, allowing other conditions to potentially override parts of it
                            // (except the recentlyBackspace flag, which should persist until the fetch check)
                        }

                        // --- Check other conditions BEFORE the fetch check ---

                        // Auto-accept logic: Only run if we have an existing suggestion
                        // This prevents clearing on every keystroke when there's no suggestion
                        if (
                            !lastKeyBackspace &&
                            value.suggestion &&
                            value.suggestion.length > 0
                        ) {
                            const lastCharacterTyped = newState.doc.textBetween(
                                newState.selection.from - 1,
                                newState.selection.from,
                                ''
                            );
                            const firstCharFromSuggestion = value.suggestion[0];

                            if (lastCharacterTyped && firstCharFromSuggestion) {
                                if (
                                    lastCharacterTyped.toLowerCase() ===
                                    firstCharFromSuggestion.toLowerCase()
                                ) {
                                    // User typed the first character of the suggestion - advance it
                                    const newSug = value.suggestion.slice(1);
                                    nextState = {
                                        suggestion: newSug,
                                        loading: false,
                                        recentlyBackspace: false,
                                    };
                                    return nextState; // Exit early after auto-accepting
                                } else {
                                    // User typed a different character - clear the suggestion
                                    nextState = {
                                        suggestion: '',
                                        loading: false,
                                        recentlyBackspace: false,
                                    };
                                    return nextState; // Exit early after clearing
                                }
                            }
                        }

                        // Handle API response
                        if (suggestionFromAPI !== undefined) {
                            const rawSuggestion = suggestionFromAPI ?? '';

                            // For suggestion storage, don't trim - we'll trim at insertion time based on position
                            const finalSuggestion = rawSuggestion;

                            // Override nextState, ensure flag is false
                            nextState = {
                                suggestion: finalSuggestion,
                                loading: false,
                                recentlyBackspace: false,
                            };
                            return nextState; // Exit early
                        }

                        // Handle manual clear or accept
                        if (suggestionCleared || suggestionAccepted) {
                            if (abortController) {
                                abortController.abort();
                                abortController = null;
                            }
                            // Override nextState, ensure flag is false
                            nextState = {
                                suggestion: '',
                                loading: false,
                                recentlyBackspace: false,
                            };
                            return nextState;
                        }

                        if (suggestionSet !== undefined) {
                            nextState = {
                                suggestion: suggestionSet,
                                loading: false,
                                recentlyBackspace: false,
                            };
                            return nextState;
                        }

                        if (value.recentlyBackspace) {
                            nextState = {
                                ...nextState,
                                recentlyBackspace: false,
                            };
                        }

                        if (
                            tr.docChanged &&
                            !suggestionAccepted &&
                            !suggestionCleared
                        ) {
                            debouncedFetchAndDispatch();
                        }

                        return nextState;
                    },
                },
                props: {
                    decorations(stateEditor: EditorState) {
                        // Check if autocomplete is enabled
                        if (!AutocompleteState.value.isEnabled) {
                            return DecorationSet.empty;
                        }

                        const { suggestion } =
                            pluginKey.getState(stateEditor) || {};
                        const { selection } = stateEditor;

                        if (suggestion && selection.empty) {
                            const { from } = selection;

                            // Check if on mobile using the imported isMobile
                            const mobile = isMobile.value;

                            // Create decoration widget
                            const deco = Decoration.widget(
                                from,
                                () => {
                                    const container =
                                        document.createElement('span');
                                    container.contentEditable = 'false';

                                    const suggestionSpan =
                                        document.createElement('span');
                                    suggestionSpan.className = 'suggestion';
                                    suggestionSpan.textContent = suggestion;
                                    suggestionSpan.style.color = 'grey';
                                    container.appendChild(suggestionSpan);

                                    if (mobile) {
                                        const acceptButton =
                                            document.createElement('button');
                                        acceptButton.className =
                                            'suggestion-accept-btn';
                                        acceptButton.textContent = 'accept';
                                        acceptButton.style.marginLeft = '4px';
                                        acceptButton.style.padding = '1px 5px';
                                        acceptButton.style.fontSize = '11px';
                                        acceptButton.style.border =
                                            '1px solid #cccccc';
                                        acceptButton.style.borderRadius = '4px';
                                        acceptButton.style.cursor = 'pointer';
                                        acceptButton.style.backgroundColor =
                                            '#f0f0f0';
                                        acceptButton.style.lineHeight = '1';

                                        acceptButton.addEventListener(
                                            'mousedown',
                                            (e) => {
                                                e.preventDefault();
                                                e.stopPropagation();

                                                const view = editorView;
                                                if (!view || view.isDestroyed)
                                                    return;

                                                const { state, dispatch } =
                                                    view;
                                                const pluginState =
                                                    pluginKey.getState(state);
                                                if (!pluginState?.suggestion)
                                                    return;

                                                const { from } =
                                                    state.selection;
                                                const $from =
                                                    state.selection.$from;
                                                const atNodeStart =
                                                    $from.parentOffset === 0;

                                                // Check if character before cursor is a space
                                                const charBefore =
                                                    state.doc.textBetween(
                                                        from - 1,
                                                        from,
                                                        ''
                                                    );
                                                const hasSpaceBefore =
                                                    charBefore === ' ';

                                                let textToInsert =
                                                    pluginState.suggestion;
                                                // Trim leading space if at node start OR if there's already a space before cursor
                                                if (
                                                    (atNodeStart ||
                                                        hasSpaceBefore) &&
                                                    textToInsert.startsWith(' ')
                                                ) {
                                                    textToInsert =
                                                        textToInsert.trimStart();
                                                }

                                                const tr = state.tr
                                                    .insertText(
                                                        textToInsert,
                                                        from
                                                    )
                                                    .setMeta(
                                                        'suggestionAccepted',
                                                        true
                                                    );

                                                dispatch(tr);

                                                requestAnimationFrame(() => {
                                                    if (!view.isDestroyed) {
                                                        view.focus();
                                                    }
                                                });
                                            }
                                        );

                                        container.appendChild(acceptButton);
                                    }

                                    return container;
                                },
                                {
                                    side: 1,
                                    stopEvent: (event) => {
                                        // Prevent the editor from handling mousedown events on our widget
                                        return event.type === 'mousedown';
                                    },
                                }
                            );

                            return DecorationSet.create(stateEditor.doc, [
                                deco,
                            ]);
                        } else {
                            return DecorationSet.empty;
                        }
                    },
                },
            }),
        ];
    },

    addKeyboardShortcuts() {
        return {
            Tab: ({ editor }: { editor: Editor }) => {
                // Check if autocomplete is enabled
                if (!AutocompleteState.value.isEnabled) {
                    return false;
                }

                const pluginState = pluginKey.getState(editor.state);
                if (pluginState?.suggestion && !pluginState?.loading) {
                    const { state, dispatch } = editor.view;
                    const { from } = state.selection;
                    const $from = state.selection.$from;
                    const atNodeStart = $from.parentOffset === 0;

                    // Check if character before cursor is a space
                    const charBefore = state.doc.textBetween(
                        from - 1,
                        from,
                        ''
                    );
                    const hasSpaceBefore = charBefore === ' ';

                    // Determine text to insert
                    let textToInsert = pluginState.suggestion;

                    // Trim leading space if we're at node start OR if there's already a space before cursor
                    if (
                        (atNodeStart || hasSpaceBefore) &&
                        textToInsert.startsWith(' ')
                    ) {
                        textToInsert = textToInsert.trimStart();
                    }

                    const tr = state.tr
                        .insertText(textToInsert, from)
                        .setMeta('suggestionAccepted', true);

                    if (dispatch) {
                        dispatch(tr);
                        // Use requestAnimationFrame for better focus handling
                        requestAnimationFrame(() => {
                            if (editor.view && !editor.view.isDestroyed) {
                                editor.view.focus();
                            }
                        });
                        return true;
                    }
                }
                return false;
            },
            Escape: () => {
                // Check if autocomplete is enabled
                if (!AutocompleteState.value.isEnabled) {
                    return false;
                }

                const pluginState = pluginKey.getState(this.editor.state);
                if (pluginState?.suggestion || pluginState?.loading) {
                    const tr = this.editor.state.tr.setMeta(
                        'suggestionCleared',
                        true
                    );
                    this.editor.view.dispatch(tr);
                    return true;
                }
                return false;
            },
            Backspace: () => {
                // Check if autocomplete is enabled
                if (!AutocompleteState.value.isEnabled) {
                    return false;
                }

                const pluginState = pluginKey.getState(this.editor.state);
                const hadSuggestionOrLoading = !!(
                    pluginState?.suggestion || pluginState?.loading
                );

                // Only dispatch metadata if we actually have a suggestion or loading state
                if (hadSuggestionOrLoading) {
                    const tr = this.editor.state.tr
                        .setMeta('lastKeyBackspace', true)
                        .setMeta('suggestionCleared', true);
                    this.editor.view.dispatch(tr);
                    // Return false to allow default backspace to still happen
                    return false;
                }

                // No suggestion, let backspace work normally without any interference
                return false;
            },
        };
    },

    addCommands(): Partial<any> {
        return {
            setSuggestion:
                (suggestion: string) =>
                ({ dispatch, state }: any) => {
                    if (dispatch) {
                        dispatch(state.tr.setMeta('suggestionSet', suggestion));
                        return true;
                    }
                    return false;
                },
            clearSuggestion:
                () =>
                ({ dispatch, state }: any) => {
                    const pluginState = pluginKey.getState(state);
                    if (
                        (pluginState?.suggestion || pluginState?.loading) &&
                        dispatch
                    ) {
                        dispatch(state.tr.setMeta('suggestionCleared', true));
                        return true;
                    }
                    return false;
                },
            acceptSuggestion:
                () =>
                ({ tr, dispatch, state }: any) => {
                    const { suggestion } = pluginKey.getState(state) || {
                        suggestion: '',
                    };
                    const { selection } = state;

                    if (suggestion && selection.empty && dispatch) {
                        const { from } = selection;
                        const $from = selection.$from;
                        const atNodeStart = $from.parentOffset === 0;

                        // Check if character before cursor is a space
                        const charBefore = state.doc.textBetween(
                            from - 1,
                            from,
                            ''
                        );
                        const hasSpaceBefore = charBefore === ' ';

                        let textToInsert = suggestion;
                        // Trim leading space if at node start OR if there's already a space before cursor
                        if (
                            (atNodeStart || hasSpaceBefore) &&
                            textToInsert.startsWith(' ')
                        ) {
                            textToInsert = textToInsert.trimStart();
                        }

                        tr.insertText(textToInsert, from);
                        tr.setMeta(pluginKey, { suggestionAccepted: true });
                        dispatch(tr);
                        return true;
                    }
                    return false;
                },
        };
    },
});
