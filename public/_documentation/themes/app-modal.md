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

On desktop the shell owns 24px outer padding, a 20px semibold title, a 36px close
control, and 28px header-to-content spacing. Phones and short viewports use 16px
padding. Touch controls have at least 44px height and the close control is square.
Footer actions wrap inside the dialog with a 10px gap; long labels and descriptions
wrap rather than widening the viewport. Long titles wrap and clamp to two lines,
keeping the close button and content reachable; the accessible title remains complete. Theme tokens still own surface colors, border width, radius, elevation,
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

## Keyboard and nested dialogs

The shell keeps Tab and Shift+Tab inside the active dialog, including Safari's
button focus behavior, and scrolls the focused control into view. Escape and
backdrop dismissal close the active layer. Closing a dialog restores its opener
or a visible navigation/input control when resizing removed the opener. Opening
a second dialog during an action preserves the new dialog's autofocus.

Use a second AppModal for nested confirmations, filters, or details so each layer
has its own accessible title, focus scope, and dismissal behavior. The optional
`content` prop preserves custom autofocus callbacks, including cancellation with
`preventDefault()`. Do not add a separate body scroll lock or a global Escape
listener around a UModal.

Safari's software keyboard can shrink and pan `window.visualViewport` while
`100dvh` retains the page height. AppModal follows that visible frame, keeping
its header and footer reachable and its body scrollable. Pinch zoom leaves the
normal layout intact. Custom UModal hosts use the internal
`useDialogFocus(options, layout)` helper with a `center`, `workspace`,
`fullscreen`, or `palette` layout; the first-run card uses
`useDialogViewport` for the same geometry. The first-run card keeps 16px side
margins and a fixed close header and helper footer around its scrolling form,
including when the key input opens the keyboard.
