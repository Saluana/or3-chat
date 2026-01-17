/**
 * Editor Extension Loader Adapter
 *
 * Wraps the lazy extension loader utilities.
 */

import {
    loadEditorExtensions,
    createLazyNodeFactory,
    createLazyMarkFactory,
    createLazyExtensionFactory,
} from '~/composables/editor/useEditorExtensionLoader';
import type { EditorLoaderAdapter } from '../client';

/**
 * Creates the editor loader adapter.
 * Provides lazy loading utilities for extensions.
 */
export function createEditorLoaderAdapter(): EditorLoaderAdapter {
    return {
        load: loadEditorExtensions,
        createLazyNodeFactory,
        createLazyMarkFactory,
        createLazyExtensionFactory,
    };
}
