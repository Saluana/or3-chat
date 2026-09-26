# AppModal

`~/components/ui/AppModal.vue` is the shared dialog shell for forms, confirmations,
Dashboard, System Prompts, and Model Catalog. It wraps Nuxt UI's `UModal`, retaining focus trapping,
Escape and backdrop dismissal, accessible titles, and focus restoration.

```vue
<AppModal v-model:open="open" title="New Document" size="sm">
    <UForm :state="state" @submit="createDocument">
        <UFormField label="Title" name="title">
            <UInput v-model="state.title" variant="modal" class="w-full" />
        </UFormField>
    </UForm>
    <template #footer>
        <UButton variant="ghost" size="modal" @click="open = false">Cancel</UButton>
        <UButton size="modal" @click="createDocument">Create</UButton>
    </template>
</AppModal>
```

Choose `sm` (560px, the default) for short forms, `md` (700px) for launchers,
and `lg` (880px) for larger content. Three-column browser dialogs use
`workspace` (1280px by at most 800px) so their columns can scroll independently.
On narrow screens, the workspace shell fills the viewport. Width is capped by
the viewport and content scrolls within the available height. The footer slot is optional; omitting it
does not reserve footer space.

The shell owns 24px outer padding, a 20px semibold title, a 36px close control,
28px header-to-content spacing, and a right-aligned footer with a 10px action
gap. Theme tokens still own surface colors, border width, radius, elevation,
and focus color. The `modal` input/textarea variant and button size are defined
once in `app/app.config.ts`. Use an 18px gap between form fields.

Existing modal theme identifiers remain available through `v-bind` with
`useThemeOverrides` or `createSidebarModalProps`. `ui` overrides are accepted,
but the shell's shared geometry takes precedence. Other `UModal` attributes and
events are forwarded. Pass a `description` when useful; it remains accessible
without adding visible header space.

Dashboard's launcher uses the medium size and grows with its registered cards.
Opening a registered page uses the large size with a bounded, scrolling page
area. Tile descriptions come from the existing `DashboardPlugin.description`
field, and images retain their Iconify fallback.
