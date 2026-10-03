# Theme identifiers

Identifier syntax, specificity, and source-component binding are maintained in
[Style a named control](../public/_documentation/themes/styling.md#style-a-named-control).
The [directive reference](../public/_documentation/themes/api-reference.md#v-theme-directive)
lists supported contexts and automatic detection limits.

Namespace source control identifiers by feature, document them with that
feature, and use the same identifier/context in the resolver and directive.
`v-theme` decorates DOM; Vue props require `useThemeOverrides()` plus `v-bind`.
Private host directives are not a portable plugin SDK surface.
