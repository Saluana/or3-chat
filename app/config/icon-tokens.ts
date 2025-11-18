export const DEFAULT_ICONS = {
    // Shell & Navigation
    'shell.sidebar.toggle.left': 'pixelarticons:arrow-bar-left',
    'shell.sidebar.toggle.right': 'pixelarticons:arrow-bar-right',
    'shell.pane.add': 'pixelarticons:card-plus',
    'shell.pane.close': 'pixelarticons:close',
    'shell.theme.light': 'pixelarticons:sun',
    'shell.theme.dark': 'pixelarticons:moon-star',
    'shell.menu': 'pixelarticons:more-vertical',
    'shell.back': 'pixelarticons:arrow-left',
    'shell.expand': 'i-lucide:folder-open',
    'shell.collapse': 'i-lucide:folder',

    // Chat Interface
    'chat.send': 'pixelarticons:arrow-up',
    'chat.stop': 'pixelarticons:pause',
    'chat.attach': 'i-lucide:plus',
    'chat.upload': 'i-lucide:upload-cloud',
    'chat.clear': 'i-lucide:x',
    'chat.model.search': 'pixelarticons:search',
    'chat.model.settings': 'pixelarticons:sliders',
    'chat.system_prompt': 'pixelarticons:script-text',

    // Chat Messages
    'chat.message.copy': 'pixelarticons:copy',
    'chat.message.retry': 'pixelarticons:reload',
    'chat.message.edit': 'pixelarticons:edit-box',
    'chat.message.branch': 'pixelarticons:git-branch',
    'chat.message.delete': 'pixelarticons:trash',
    'chat.reasoning': 'pixelarticons:lightbulb-on',

    // Tool Indicators
    'chat.tool.loader': 'pixelarticons:loader',
    'chat.tool.check': 'pixelarticons:check',
    'chat.tool.error': 'pixelarticons:close',
    'chat.tool.wrench': 'pixelarticons:wrench',

    // Sidebar
    'sidebar.search': 'pixelarticons:search',
    'sidebar.new_chat': 'pixelarticons:message-plus',
    'sidebar.new_folder': 'pixelarticons:folder-plus',
    'sidebar.new_note': 'pixelarticons:note-plus',
    'sidebar.edit': 'pixelarticons:edit',
    'sidebar.delete': 'pixelarticons:trash',
    'sidebar.folder': 'pixelarticons:folder',
    'sidebar.chat': 'pixelarticons:chat',
    'sidebar.note': 'pixelarticons:note',
    'sidebar.settings': 'pixelarticons:sliders',
    'sidebar.user': 'pixelarticons:user',
    'sidebar.project.root': 'pixelarticons:home',

    // Common UI
    'ui.check': 'pixelarticons:check',
    'ui.close': 'pixelarticons:close',
    'ui.copy': 'pixelarticons:copy',
    'ui.trash': 'pixelarticons:trash',
    'ui.edit': 'pixelarticons:edit',
    'ui.warning': 'pixelarticons:warning-box',
    'ui.info': 'pixelarticons:info-box',
    'ui.loading': 'pixelarticons:loader',
    'ui.more': 'pixelarticons:more-vertical',
    'ui.download': 'pixelarticons:download',
    'ui.upload': 'pixelarticons:cloud-upload',
    'ui.search': 'pixelarticons:search',
    'ui.filter': 'pixelarticons:list',
    'ui.sort': 'pixelarticons:sort',
    'ui.view': 'pixelarticons:eye',
    'ui.view_off': 'pixelarticons:eye-closed',
    'ui.lock': 'pixelarticons:lock',
    'ui.unlock': 'pixelarticons:lock-open',
    'ui.settings': 'pixelarticons:sliders',
    'ui.unknown': 'pixelarticons:alert',

    // Dashboard
    'dashboard.home': 'pixelarticons:dashboard',
    'dashboard.plugins': 'pixelarticons:zap',
    'dashboard.settings': 'pixelarticons:sliders',
    'dashboard.backup': 'pixelarticons:briefcase-download',
    'dashboard.restore': 'pixelarticons:briefcase-upload',

    // Documents / Editor
    'editor.code': 'pixelarticons:code',
    'editor.list': 'pixelarticons:list',
    'editor.undo': 'pixelarticons:undo',
    'editor.redo': 'pixelarticons:redo',

    // Images
    'image.download': 'pixelarticons:download',
    'image.copy': 'pixelarticons:copy',
    'image.delete': 'pixelarticons:image-delete',
    'image.repeat': 'pixelarticons:repeat',
    'image.multiple': 'pixelarticons:image-multiple',
} as const;

export type IconToken = keyof typeof DEFAULT_ICONS;
