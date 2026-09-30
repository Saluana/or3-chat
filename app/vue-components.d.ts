/**
 * Bring the repository's `.vue` module shim into the app program.
 *
 * The generated `.nuxt/tsconfig.app.json` does not include `types/`, so without
 * this reference every `.vue` import (including relative ones, which TypeScript
 * cannot resolve as arbitrary extensions) is reported as missing.
 */
/// <reference path="../types/shims-vue.d.ts" />
