# Theme icons

Icon authoring and source-component binding are maintained in
[Style your theme](../public/_documentation/themes/styling.md#icons).
The [theme reference](../public/_documentation/themes/api-reference.md#useicon)
covers `useIcon`, typed tokens, fallback behavior, and loader ownership.

Add host tokens in [icon-tokens.ts](../app/config/icon-tokens.ts); theme packages
override existing tokens through their definition or `icons.config.ts`.
Create icon refs during setup and let Vue unwrap them in templates.
