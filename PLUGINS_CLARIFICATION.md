# Admin Dashboard Plugin System - Clarification

## Question: "Why are pre-designed plugins in the plugins directory not displayed in the plugins page?"

### Answer

There is a misunderstanding about what constitutes a "plugin" in OR3-chat. The system has two different types of plugins:

### 1. **Nuxt Plugins** (Development Code)
- **Location**: `app/plugins/`
- **Purpose**: Runtime code that runs on application startup
- **Type**: TypeScript/Vue files (.client.ts, .server.ts)
- **Examples**: 
  - `app/plugins/examples/snake-game.client.ts`
  - `app/plugins/examples/dashboard-plugins-example.client.ts`
  - `app/plugins/message-actions.client.ts`
- **Visibility**: These run automatically but are NOT displayed in the admin panel
- **Nature**: These are development examples and built-in features, not distributable extensions

### 2. **Distributable Extensions** (Installable Plugins)
- **Location**: `extensions/plugins/` (after installation)
- **Purpose**: User-installable functionality packaged as ZIP files
- **Type**: Must contain `or3.manifest.json` file
- **Examples**: None shipped by default
- **Visibility**: These ARE displayed in the admin panel's Plugins page
- **Nature**: These are third-party or custom extensions

## Current State

**The OR3-chat codebase does NOT ship with any pre-packaged distributable plugins.**

The admin panel's Plugins page (`/admin/plugins`) is specifically for:
- Installing plugin ZIP files
- Enabling/disabling installed plugins
- Configuring plugin settings
- Uninstalling plugins

## Why the Plugins Page Appears Empty

1. No plugins have been installed via the ZIP upload mechanism
2. The `extensions/` directory only contains a `.gitkeep` file
3. The example plugins in `app/plugins/examples/` are NOT distributable extensions

## How to Add Plugins to the Admin Panel

To create a distributable plugin that appears in the admin panel, you need:

1. **Create a plugin directory structure:**
```
my-plugin/
├── or3.manifest.json
├── plugin.ts
└── components/
    └── MyComponent.vue
```

2. **Create an or3.manifest.json file:**
```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "kind": "plugin",
  "description": "Description of my plugin",
  "capabilities": {
    "chatActions": true,
    "adminPages": true
  }
}
```

3. **Package as ZIP and install:**
   - Zip the directory
   - Upload via Admin > Plugins > "Install .zip" button
   - Plugin will then appear in the list

## Example Plugins Available

While no distributable plugins are included, the codebase contains many **development examples** in `app/plugins/examples/`:

- Snake Game (`snake-game.client.ts`)
- Dashboard Plugins (`dashboard-plugins-example.client.ts`)
- Message Actions (`message-actions-test.client.ts`)
- Editor Toolbar (`editor-toolbar-test.client.ts`)
- Custom Pane TODO (`custom-pane-todo-example.client.ts`)
- And many more...

These serve as reference implementations but are not packaged as distributable extensions.

## Recommendation

If the goal is to provide example plugins that users can enable/disable via the admin panel:

1. **Create example plugin packages** with proper manifest files
2. **Document the plugin creation process** in the repository
3. **Provide a plugin template/generator** for developers
4. **Ship example plugins** as separate ZIP files in a `examples/` directory
5. **Add documentation** linking to plugin development guides

## Related Documentation

- Plugin development guide: `docs/plugins/sidebar-plugin-guide.md`
- Admin plugin API: `app/composables/admin/useAdminPlugins.ts`
- Extension manager: `server/admin/extensions/extension-manager.ts`
- Extension types: `server/admin/extensions/types.ts`

## Conclusion

**The "pre-designed plugins" mentioned in the problem statement do not exist as distributable extensions.** The plugins directory contains Nuxt plugins (runtime code), not installable plugin packages. The admin Plugins page is working correctly - it simply has no plugins installed by default.
