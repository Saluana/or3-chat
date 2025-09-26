<template>
    <!-- Root no longer forces full height or its own scroll; parent provides scroll container -->
    <div class="px-4 py-4 space-y-12 text-sm">
        <!-- Accessible live region for status updates -->
        <p ref="liveStatus" class="sr-only" aria-live="polite"></p>
        <!-- Mode Toggle -->
        <section
            class="section-card space-y-2"
            role="group"
            aria-labelledby="theme-section-mode"
        >
            <div class="flex items-center justify-between flex-wrap gap-3">
                <h2
                    id="theme-section-mode"
                    class="font-heading text-base uppercase tracking-wide group-heading"
                >
                    Theme Mode
                </h2>
                <div class="flex gap-2 items-center">
                    <UButton
                        size="sm"
                        variant="basic"
                        class="retro-chip"
                        :class="activeMode === 'light' ? 'active' : ''"
                        :disabled="activeMode === 'light'"
                        :aria-pressed="activeMode === 'light'"
                        @click="switchMode('light')"
                        >Light</UButton
                    >
                    <UButton
                        size="sm"
                        variant="basic"
                        class="retro-chip"
                        :class="activeMode === 'dark' ? 'active' : ''"
                        :disabled="activeMode === 'dark'"
                        :aria-pressed="activeMode === 'dark'"
                        @click="switchMode('dark')"
                        >Dark</UButton
                    >
                    <UButton
                        size="sm"
                        variant="basic"
                        class="retro-chip"
                        aria-label="Reset current theme mode"
                        @click="onResetCurrent"
                        :title="'Reset ' + activeMode + ' profile'"
                        >Reset {{ activeMode }}</UButton
                    >
                </div>
            </div>
            <p class="text-xs opacity-70">
                Each mode stores its own backgrounds & colors. Use Reset (mode)
                for just this profile or Reset All below for both.
            </p>
        </section>
        <!-- Color Palette Overrides -->
        <section
            class="section-card space-y-3"
            role="group"
            aria-labelledby="theme-section-palette"
        >
            <h2
                id="theme-section-palette"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Color Palette
            </h2>
            <p class="supporting-text">
                Override core Material colors for this mode. Toggle off to use
                the theme's defaults.
            </p>
            <label class="flex items-center gap-2 cursor-pointer select-none">
                <input
                    type="checkbox"
                    :checked="(settings as any).paletteEnabled"
                    @change="
                        set({
                            paletteEnabled: !(settings as any).paletteEnabled,
                        } as any)
                    "
                />
                <span class="text-xs">Enable palette overrides</span>
            </label>
            <div class="space-y-3 pt-1">
                <div class="flex items-center gap-4">
                    <label class="w-32 text-xs">Primary</label>
                    <UColorPicker
                        :disabled="!(settings as any).paletteEnabled"
                        :model-value="
                            (settings as any).paletteEnabled &&
                            String((settings as any).palettePrimary || '').startsWith('#')
                                ? (settings as any).palettePrimary
                                : undefined
                        "
                        @update:model-value="(c: string | undefined)=> c && set({ palettePrimary: c } as any)"
                        class="scale-60 origin-left"
                    />
                    <div class="flex items-center gap-2">
                        <input
                            class="retro-input w-24"
                            type="text"
                            spellcheck="false"
                            maxlength="9"
                            placeholder="#RRGGBB"
                            v-model="(localHex as any).palettePrimary"
                            @input="onHexInput('palettePrimary' as any)"
                            :disabled="!(settings as any).paletteEnabled"
                            aria-label="Primary hex color"
                        />
                        <button
                            type="button"
                            class="retro-btn-copy"
                            @click="copyColor('palettePrimary' as any)"
                            :disabled="
                                !(settings as any).paletteEnabled ||
                                !String((settings as any).palettePrimary || '').startsWith('#')
                            "
                            aria-label="Copy primary color"
                            title="Copy"
                        >
                            Copy
                        </button>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <label class="w-32 text-xs">Secondary</label>
                    <UColorPicker
                        :disabled="!(settings as any).paletteEnabled"
                        :model-value="
                            (settings as any).paletteEnabled &&
                            String((settings as any).paletteSecondary || '').startsWith('#')
                                ? (settings as any).paletteSecondary
                                : undefined
                        "
                        @update:model-value="(c: string | undefined)=> c && set({ paletteSecondary: c } as any)"
                        class="scale-60 origin-left"
                    />
                    <div class="flex items-center gap-2">
                        <input
                            class="retro-input w-24"
                            type="text"
                            spellcheck="false"
                            maxlength="9"
                            placeholder="#RRGGBB"
                            v-model="(localHex as any).paletteSecondary"
                            @input="onHexInput('paletteSecondary' as any)"
                            :disabled="!(settings as any).paletteEnabled"
                            aria-label="Secondary hex color"
                        />
                        <button
                            type="button"
                            class="retro-btn-copy"
                            @click="copyColor('paletteSecondary' as any)"
                            :disabled="
                                !(settings as any).paletteEnabled ||
                                !String((settings as any).paletteSecondary || '').startsWith('#')
                            "
                            aria-label="Copy secondary color"
                            title="Copy"
                        >
                            Copy
                        </button>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <label class="w-32 text-xs">Error</label>
                    <UColorPicker
                        :disabled="!(settings as any).paletteEnabled"
                        :model-value="
                            (settings as any).paletteEnabled &&
                            String((settings as any).paletteError || '').startsWith('#')
                                ? (settings as any).paletteError
                                : undefined
                        "
                        @update:model-value="(c: string | undefined)=> c && set({ paletteError: c } as any)"
                        class="scale-60 origin-left"
                    />
                    <div class="flex items-center gap-2">
                        <input
                            class="retro-input w-24"
                            type="text"
                            spellcheck="false"
                            maxlength="9"
                            placeholder="#RRGGBB"
                            v-model="(localHex as any).paletteError"
                            @input="onHexInput('paletteError' as any)"
                            :disabled="!(settings as any).paletteEnabled"
                            aria-label="Error hex color"
                        />
                        <button
                            type="button"
                            class="retro-btn-copy"
                            @click="copyColor('paletteError' as any)"
                            :disabled="
                                !(settings as any).paletteEnabled ||
                                !String((settings as any).paletteError || '').startsWith('#')
                            "
                            aria-label="Copy error color"
                            title="Copy"
                        >
                            Copy
                        </button>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <label class="w-32 text-xs">Surface Variant</label>
                    <UColorPicker
                        :disabled="!(settings as any).paletteEnabled"
                        :model-value="
                            (settings as any).paletteEnabled &&
                            String((settings as any).paletteSurfaceVariant || '').startsWith('#')
                                ? (settings as any).paletteSurfaceVariant
                                : undefined
                        "
                        @update:model-value="(c: string | undefined)=> c && set({ paletteSurfaceVariant: c } as any)"
                        class="scale-60 origin-left"
                    />
                    <div class="flex items-center gap-2">
                        <input
                            class="retro-input w-24"
                            type="text"
                            spellcheck="false"
                            maxlength="9"
                            placeholder="#RRGGBB"
                            v-model="(localHex as any).paletteSurfaceVariant"
                            @input="onHexInput('paletteSurfaceVariant' as any)"
                            :disabled="!(settings as any).paletteEnabled"
                            aria-label="Surface Variant hex color"
                        />
                        <button
                            type="button"
                            class="retro-btn-copy"
                            @click="copyColor('paletteSurfaceVariant' as any)"
                            :disabled="
                                !(settings as any).paletteEnabled ||
                                !String((settings as any).paletteSurfaceVariant || '').startsWith('#')
                            "
                            aria-label="Copy surface variant color"
                            title="Copy"
                        >
                            Copy
                        </button>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <label class="w-32 text-xs">Border</label>
                    <UColorPicker
                        :disabled="!(settings as any).paletteEnabled"
                        :model-value="
                            (settings as any).paletteEnabled &&
                            String((settings as any).paletteBorder || '').startsWith('#')
                                ? (settings as any).paletteBorder
                                : undefined
                        "
                        @update:model-value="(c: string | undefined)=> c && set({ paletteBorder: c } as any)"
                        class="scale-60 origin-left"
                    />
                    <div class="flex items-center gap-2">
                        <input
                            class="retro-input w-24"
                            type="text"
                            spellcheck="false"
                            maxlength="9"
                            placeholder="#RRGGBB"
                            v-model="(localHex as any).paletteBorder"
                            @input="onHexInput('paletteBorder' as any)"
                            :disabled="!(settings as any).paletteEnabled"
                            aria-label="Border hex color"
                        />
                        <button
                            type="button"
                            class="retro-btn-copy"
                            @click="copyColor('paletteBorder' as any)"
                            :disabled="
                                !(settings as any).paletteEnabled ||
                                !String((settings as any).paletteBorder || '').startsWith('#')
                            "
                            aria-label="Copy border color"
                            title="Copy"
                        >
                            Copy
                        </button>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <label class="w-32 text-xs">Surface</label>
                    <UColorPicker
                        :disabled="!(settings as any).paletteEnabled"
                        :model-value="
                            (settings as any).paletteEnabled &&
                            String((settings as any).paletteSurface || '').startsWith('#')
                                ? (settings as any).paletteSurface
                                : undefined
                        "
                        @update:model-value="(c: string | undefined)=> c && set({ paletteSurface: c } as any)"
                        class="scale-60 origin-left"
                    />
                    <div class="flex items-center gap-2">
                        <input
                            class="retro-input w-24"
                            type="text"
                            spellcheck="false"
                            maxlength="9"
                            placeholder="#RRGGBB"
                            v-model="(localHex as any).paletteSurface"
                            @input="onHexInput('paletteSurface' as any)"
                            :disabled="!(settings as any).paletteEnabled"
                            aria-label="Surface hex color"
                        />
                        <button
                            type="button"
                            class="retro-btn-copy"
                            @click="copyColor('paletteSurface' as any)"
                            :disabled="
                                !(settings as any).paletteEnabled ||
                                !String((settings as any).paletteSurface || '').startsWith('#')
                            "
                            aria-label="Copy surface color"
                            title="Copy"
                        >
                            Copy
                        </button>
                    </div>
                </div>
            </div>
        </section>
        <!-- Custom Background Colors Master Toggle -->
        <section
            class="section-card space-y-2"
            role="group"
            aria-labelledby="theme-section-custom-bg"
        >
            <h2
                id="theme-section-custom-bg"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Custom Background Colors
            </h2>
            <label class="flex items-center gap-2 cursor-pointer select-none">
                <input
                    type="checkbox"
                    :checked="settings.customBgColorsEnabled"
                    @change="
                        set({
                            customBgColorsEnabled:
                                !settings.customBgColorsEnabled,
                        });
                        reapply();
                    "
                />
                <span class="text-xs"
                    >Enable custom background color overrides</span
                >
            </label>
            <p
                class="text-xs opacity-70"
                v-if="!settings.customBgColorsEnabled"
            >
                Disabled: system/theme background colors shown.
            </p>
            <p class="text-xs opacity-70" v-else>
                Enabled: custom values below override system backgrounds.
            </p>
        </section>
        <!-- Typography -->
        <section
            class="section-card space-y-3"
            role="group"
            aria-labelledby="theme-section-typography"
        >
            <h2
                id="theme-section-typography"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Typography
            </h2>
            <div class="flex items-center gap-4">
                <label class="w-32">Base Font</label>
                <input
                    type="range"
                    min="14"
                    max="24"
                    :value="local.baseFontPx"
                    @input="onFontSizeRange($event)"
                    class="flex-1"
                />
                <span class="w-10 text-center tabular-nums"
                    >{{ local.baseFontPx }}px</span
                >
            </div>
            <label
                class="flex items-center gap-2 cursor-pointer select-none pt-2"
            >
                <input
                    type="checkbox"
                    :checked="settings.useSystemFont"
                    @change="set({ useSystemFont: !settings.useSystemFont })"
                />
                <span class="text-xs">Use system font for body & headings</span>
            </label>
        </section>

        <!-- Content Background Layer 1 -->
        <section
            class="section-card space-y-4"
            role="group"
            aria-labelledby="theme-section-content1"
        >
            <h2
                id="theme-section-content1"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Content Layer 1
            </h2>
            <p class="supporting-text">
                Primary pattern beneath UI chrome. Size slider disabled when Fit
                is enabled.
            </p>
            <!-- Preview row -->
            <div class="flex items-center gap-3">
                <div
                    class="pattern-thumb drop-zone"
                    :class="[
                        !settings.contentBg1 || local.contentBg1Opacity === 0
                            ? 'opacity-30'
                            : '',
                        dragOver.contentBg1 ? 'is-dragover' : '',
                    ]"
                    :style="contentBg1PreviewStyle"
                    aria-label="Content background layer 1 (click or drop to upload)"
                    role="button"
                    tabindex="0"
                    @click="openFile('contentBg1')"
                    @keydown.enter.prevent="openFile('contentBg1')"
                    @dragenter.prevent="onDragEnter($event, 'contentBg1')"
                    @dragover.prevent="onDragOver($event)"
                    @dragleave.prevent="onDragLeave($event, 'contentBg1')"
                    @drop.prevent="onDrop($event, 'contentBg1')"
                >
                    <span class="dz-hint" aria-hidden="true">Drop / Tap</span>
                </div>
                <span
                    class="text-xs truncate max-w-[160px]"
                    :title="displayName(settings.contentBg1)"
                >
                    {{
                        settings.contentBg1
                            ? displayName(settings.contentBg1)
                            : 'None'
                    }}
                </span>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <span class="text-xs opacity-70">Presets:</span>
                <UButton
                    size="sm"
                    variant="basic"
                    v-for="p in presetsContent1"
                    :key="p.src"
                    @click="applyPreset('contentBg1', p.src, p.opacity)"
                    class="retro-chip"
                    :class="isPresetActive('contentBg1', p.src)"
                >
                    {{ p.label }}
                </UButton>
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    @click="removeLayer('contentBg1')"
                >
                    Remove
                </UButton>
                <!-- hidden input for programmatic trigger -->
                <input
                    :ref="(el:any)=> fileInputs.contentBg1 = el"
                    type="file"
                    class="sr-only"
                    accept="image/*"
                    @change="onUpload($event, 'contentBg1')"
                />
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    @click="toggleRepeat('contentBg1Repeat')"
                    :aria-pressed="settings.contentBg1Repeat === 'repeat'"
                >
                    Repeat:
                    {{ settings.contentBg1Repeat === 'repeat' ? 'On' : 'Off' }}
                </UButton>
                <label
                    class="flex items-center gap-1 text-[10px] cursor-pointer select-none"
                >
                    <input
                        type="checkbox"
                        :checked="settings.contentBg1Fit"
                        @change="
                            set({ contentBg1Fit: !settings.contentBg1Fit })
                        "
                    />
                    Fit
                </label>
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32">Opacity</label>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="local.contentBg1Opacity"
                    @input="onOpacityRange($event, 'contentBg1Opacity')"
                    class="flex-1"
                />
                <span class="w-12 text-right tabular-nums">{{
                    local.contentBg1Opacity.toFixed(2)
                }}</span>
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32">Size</label>
                <input
                    type="range"
                    min="8"
                    max="1200"
                    :disabled="settings.contentBg1Fit"
                    :value="local.contentBg1SizePx"
                    @input="onSizeRange($event, 'contentBg1SizePx')"
                    class="flex-1"
                />
                <span class="w-16 text-right tabular-nums text-xs">{{
                    settings.contentBg1Fit
                        ? 'cover'
                        : local.contentBg1SizePx + 'px'
                }}</span>
            </div>
            <div class="flex items-center gap-4 fallback-row">
                <label class="w-32 text-xs">Fallback Color</label>
                <UColorPicker
                    :disabled="!settings.customBgColorsEnabled"
                    :model-value="
                        settings.customBgColorsEnabled &&
                        settings.contentBg1Color.startsWith('#')
                            ? settings.contentBg1Color
                            : undefined
                    "
                    @update:model-value="(c: string | undefined)=> c && set({ contentBg1Color: c })"
                    class="scale-60 origin-left"
                />
                <div class="flex items-center gap-2">
                    <input
                        class="retro-input w-24"
                        type="text"
                        spellcheck="false"
                        maxlength="9"
                        placeholder="#RRGGBB"
                        v-model="localHex.contentBg1Color"
                        @input="onHexInput('contentBg1Color')"
                        :disabled="!settings.customBgColorsEnabled"
                        aria-label="Content layer 1 fallback hex color"
                    />
                    <button
                        type="button"
                        class="retro-btn-copy"
                        @click="copyColor('contentBg1Color')"
                        :disabled="
                            !settings.customBgColorsEnabled ||
                            !settings.contentBg1Color.startsWith('#')
                        "
                        aria-label="Copy content layer 1 color"
                        title="Copy"
                    >
                        Copy
                    </button>
                </div>
            </div>
        </section>

        <!-- Content Background Layer 2 -->
        <section
            class="section-card space-y-4"
            role="group"
            aria-labelledby="theme-section-content2"
        >
            <h2
                id="theme-section-content2"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Content Layer 2
            </h2>
            <p class="supporting-text">
                Optional overlay pattern. Lower opacity recommended for subtle
                texture.
            </p>
            <div class="flex items-center gap-3">
                <div
                    class="pattern-thumb drop-zone"
                    :class="[
                        !settings.contentBg2 || local.contentBg2Opacity === 0
                            ? 'opacity-30'
                            : '',
                        dragOver.contentBg2 ? 'is-dragover' : '',
                    ]"
                    :style="contentBg2PreviewStyle"
                    aria-label="Content background layer 2 (click or drop to upload)"
                    role="button"
                    tabindex="0"
                    @click="openFile('contentBg2')"
                    @keydown.enter.prevent="openFile('contentBg2')"
                    @dragenter.prevent="onDragEnter($event, 'contentBg2')"
                    @dragover.prevent="onDragOver($event)"
                    @dragleave.prevent="onDragLeave($event, 'contentBg2')"
                    @drop.prevent="onDrop($event, 'contentBg2')"
                >
                    <span class="dz-hint" aria-hidden="true">Drop / Tap</span>
                </div>
                <span
                    class="text-xs truncate max-w-[160px]"
                    :title="displayName(settings.contentBg2)"
                >
                    {{
                        settings.contentBg2
                            ? displayName(settings.contentBg2)
                            : 'Disabled'
                    }}
                </span>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <span class="text-xs opacity-70">Presets:</span>
                <UButton
                    size="sm"
                    variant="basic"
                    v-for="p in presetsContent2"
                    :key="p.src"
                    @click="applyPreset('contentBg2', p.src, p.opacity)"
                    class="retro-chip"
                    :class="isPresetActive('contentBg2', p.src)"
                >
                    {{ p.label }}
                </UButton>
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    @click="removeLayer('contentBg2')"
                >
                    Remove
                </UButton>
                <input
                    :ref="(el:any)=> fileInputs.contentBg2 = el"
                    type="file"
                    class="sr-only"
                    accept="image/*"
                    @change="onUpload($event, 'contentBg2')"
                />
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    @click="toggleRepeat('contentBg2Repeat')"
                    :aria-pressed="settings.contentBg2Repeat === 'repeat'"
                >
                    Repeat:
                    {{ settings.contentBg2Repeat === 'repeat' ? 'On' : 'Off' }}
                </UButton>
                <label
                    class="flex items-center gap-1 text-[10px] cursor-pointer select-none"
                >
                    <input
                        type="checkbox"
                        :checked="settings.contentBg2Fit"
                        @change="
                            set({ contentBg2Fit: !settings.contentBg2Fit })
                        "
                    />
                    Fit
                </label>
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32">Opacity</label>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="local.contentBg2Opacity"
                    @input="onOpacityRange($event, 'contentBg2Opacity')"
                    class="flex-1"
                />
                <span class="w-12 text-right tabular-nums">{{
                    local.contentBg2Opacity.toFixed(2)
                }}</span>
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32">Size</label>
                <input
                    type="range"
                    min="8"
                    max="1200"
                    :disabled="settings.contentBg2Fit"
                    :value="local.contentBg2SizePx"
                    @input="onSizeRange($event, 'contentBg2SizePx')"
                    class="flex-1"
                />
                <span class="w-16 text-right tabular-nums text-xs">{{
                    settings.contentBg2Fit
                        ? 'cover'
                        : local.contentBg2SizePx + 'px'
                }}</span>
            </div>
            <div class="flex items-center gap-4 fallback-row">
                <label class="w-32 text-xs">Fallback Color</label>
                <UColorPicker
                    :disabled="!settings.customBgColorsEnabled"
                    :model-value="
                        settings.customBgColorsEnabled &&
                        settings.contentBg2Color.startsWith('#')
                            ? settings.contentBg2Color
                            : undefined
                    "
                    @update:model-value="(c: string | undefined)=> c && set({ contentBg2Color: c })"
                    class="scale-60 origin-left"
                />
                <div class="flex items-center gap-2">
                    <input
                        class="retro-input w-24"
                        type="text"
                        spellcheck="false"
                        maxlength="9"
                        placeholder="#RRGGBB"
                        v-model="localHex.contentBg2Color"
                        @input="onHexInput('contentBg2Color')"
                        :disabled="!settings.customBgColorsEnabled"
                        aria-label="Content layer 2 fallback hex color"
                    />
                    <button
                        type="button"
                        class="retro-btn-copy"
                        @click="copyColor('contentBg2Color')"
                        :disabled="
                            !settings.customBgColorsEnabled ||
                            !settings.contentBg2Color.startsWith('#')
                        "
                        aria-label="Copy content layer 2 color"
                        title="Copy"
                    >
                        Copy
                    </button>
                </div>
            </div>
        </section>

        <!-- Sidebar Background -->
        <section
            class="section-card space-y-4"
            role="group"
            aria-labelledby="theme-section-sidebar"
        >
            <h2
                id="theme-section-sidebar"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Sidebar Background
            </h2>
            <p class="supporting-text">
                Applies to navigation rail / project tree area.
            </p>
            <div class="flex items-center gap-3">
                <div
                    class="pattern-thumb drop-zone"
                    :class="[
                        !settings.sidebarBg || local.sidebarBgOpacity === 0
                            ? 'opacity-30'
                            : '',
                        dragOver.sidebarBg ? 'is-dragover' : '',
                    ]"
                    :style="sidebarBgPreviewStyle"
                    aria-label="Sidebar background (click or drop to upload)"
                    role="button"
                    tabindex="0"
                    @click="openFile('sidebarBg')"
                    @keydown.enter.prevent="openFile('sidebarBg')"
                    @dragenter.prevent="onDragEnter($event, 'sidebarBg')"
                    @dragover.prevent="onDragOver($event)"
                    @dragleave.prevent="onDragLeave($event, 'sidebarBg')"
                    @drop.prevent="onDrop($event, 'sidebarBg')"
                >
                    <span class="dz-hint" aria-hidden="true">Drop / Tap</span>
                </div>
                <span
                    class="text-xs truncate max-w-[160px]"
                    :title="displayName(settings.sidebarBg)"
                >
                    {{
                        settings.sidebarBg
                            ? displayName(settings.sidebarBg)
                            : 'None'
                    }}
                </span>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <span class="text-xs opacity-70">Presets:</span>
                <UButton
                    size="sm"
                    variant="basic"
                    v-for="p in presetsSidebar"
                    :key="p.src"
                    @click="applyPreset('sidebarBg', p.src, p.opacity)"
                    class="retro-chip"
                    :class="isPresetActive('sidebarBg', p.src)"
                >
                    {{ p.label }}
                </UButton>
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    @click="removeLayer('sidebarBg')"
                >
                    Remove
                </UButton>
                <input
                    :ref="(el:any)=> fileInputs.sidebarBg = el"
                    type="file"
                    class="sr-only"
                    accept="image/*"
                    @change="onUpload($event, 'sidebarBg')"
                />
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    @click="toggleRepeat('sidebarRepeat')"
                    :aria-pressed="settings.sidebarRepeat === 'repeat'"
                >
                    Repeat:
                    {{ settings.sidebarRepeat === 'repeat' ? 'On' : 'Off' }}
                </UButton>
                <label
                    class="flex items-center gap-1 text-[10px] cursor-pointer select-none"
                >
                    <input
                        type="checkbox"
                        :checked="settings.sidebarBgFit"
                        @change="set({ sidebarBgFit: !settings.sidebarBgFit })"
                    />
                    Fit
                </label>
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32">Opacity</label>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="local.sidebarBgOpacity"
                    @input="onOpacityRange($event, 'sidebarBgOpacity')"
                    class="flex-1"
                />
                <span class="w-12 text-right tabular-nums">{{
                    local.sidebarBgOpacity.toFixed(2)
                }}</span>
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32">Size</label>
                <input
                    type="range"
                    min="8"
                    max="1200"
                    :disabled="settings.sidebarBgFit"
                    :value="local.sidebarBgSizePx"
                    @input="onSizeRange($event, 'sidebarBgSizePx')"
                    class="flex-1"
                />
                <span class="w-16 text-right tabular-nums text-xs">{{
                    settings.sidebarBgFit
                        ? 'cover'
                        : local.sidebarBgSizePx + 'px'
                }}</span>
            </div>
            <div class="flex items-center gap-4 fallback-row">
                <label class="w-32 text-xs">Fallback Color</label>
                <UColorPicker
                    :disabled="!settings.customBgColorsEnabled"
                    :model-value="
                        settings.customBgColorsEnabled &&
                        settings.sidebarBgColor.startsWith('#')
                            ? settings.sidebarBgColor
                            : undefined
                    "
                    @update:model-value="(c: string | undefined)=> c && set({ sidebarBgColor: c })"
                    class="scale-60 origin-left"
                />
                <div class="flex items-center gap-2">
                    <input
                        class="retro-input w-24"
                        type="text"
                        spellcheck="false"
                        maxlength="9"
                        placeholder="#RRGGBB"
                        v-model="localHex.sidebarBgColor"
                        @input="onHexInput('sidebarBgColor')"
                        :disabled="!settings.customBgColorsEnabled"
                        aria-label="Sidebar fallback hex color"
                    />
                    <button
                        type="button"
                        class="retro-btn-copy"
                        @click="copyColor('sidebarBgColor')"
                        :disabled="
                            !settings.customBgColorsEnabled ||
                            !settings.sidebarBgColor.startsWith('#')
                        "
                        aria-label="Copy sidebar color"
                        title="Copy"
                    >
                        Copy
                    </button>
                </div>
            </div>
        </section>

        <!-- Accessibility -->
        <section
            class="section-card space-y-3"
            role="group"
            aria-labelledby="theme-section-accessibility"
        >
            <h2
                id="theme-section-accessibility"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Accessibility
            </h2>
            <label class="flex items-center gap-2 cursor-pointer select-none">
                <input
                    type="checkbox"
                    :checked="settings.reducePatternsInHighContrast"
                    @change="toggleReduceHighContrast"
                />
                <span class="text-xs"
                    >Reduce pattern opacity in high contrast modes</span
                >
            </label>
        </section>

        <!-- Navigation Header -->
        <section
            class="section-card space-y-4"
            role="group"
            aria-labelledby="theme-section-header"
        >
            <h2
                id="theme-section-header"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Navigation Header
            </h2>
            <div class="flex items-center gap-3 text-xs">
                <span class="opacity-70">Gradient:</span>
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    :disabled="settings.showHeaderGradient"
                    @click="set({ showHeaderGradient: true })"
                    >Default</UButton
                >
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    :disabled="!settings.showHeaderGradient"
                    @click="set({ showHeaderGradient: false })"
                    >Remove</UButton
                >
                <span class="opacity-60"
                    >Current:
                    {{
                        settings.showHeaderGradient ? 'Default' : 'Removed'
                    }}</span
                >
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32 text-xs">Background Color</label>
                <UColorPicker
                    :disabled="!settings.customBgColorsEnabled"
                    :model-value="
                        settings.customBgColorsEnabled &&
                        settings.headerBgColor.startsWith('#')
                            ? settings.headerBgColor
                            : undefined
                    "
                    @update:model-value="(c: string | undefined)=> c && set({ headerBgColor: c })"
                    class="scale-60 origin-left"
                />
                <div class="flex items-center gap-2">
                    <input
                        class="retro-input w-24"
                        type="text"
                        spellcheck="false"
                        maxlength="9"
                        placeholder="#RRGGBB"
                        v-model="localHex.headerBgColor"
                        @input="onHexInput('headerBgColor')"
                        :disabled="!settings.customBgColorsEnabled"
                        aria-label="Header background hex color"
                    />
                    <button
                        type="button"
                        class="retro-btn-copy"
                        @click="copyColor('headerBgColor')"
                        :disabled="
                            !settings.customBgColorsEnabled ||
                            !settings.headerBgColor.startsWith('#')
                        "
                        aria-label="Copy header color"
                        title="Copy"
                    >
                        Copy
                    </button>
                </div>
            </div>
        </section>

        <!-- Navigation Footer -->
        <section
            class="section-card space-y-4"
            role="group"
            aria-labelledby="theme-section-footer"
        >
            <h2
                id="theme-section-footer"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Navigation Footer
            </h2>
            <div class="flex items-center gap-3 text-xs">
                <span class="opacity-70">Gradient:</span>
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    :disabled="settings.showBottomBarGradient"
                    @click="set({ showBottomBarGradient: true })"
                    >Default</UButton
                >
                <UButton
                    size="sm"
                    variant="basic"
                    class="retro-chip"
                    :disabled="!settings.showBottomBarGradient"
                    @click="set({ showBottomBarGradient: false })"
                    >Remove</UButton
                >
                <span class="opacity-60"
                    >Current:
                    {{
                        settings.showBottomBarGradient ? 'Default' : 'Removed'
                    }}</span
                >
            </div>
            <div class="flex items-center gap-4">
                <label class="w-32 text-xs">Background Color</label>
                <UColorPicker
                    :disabled="!settings.customBgColorsEnabled"
                    :model-value="
                        settings.customBgColorsEnabled &&
                        settings.bottomBarBgColor.startsWith('#')
                            ? settings.bottomBarBgColor
                            : undefined
                    "
                    @update:model-value="(c: string | undefined)=> c && set({ bottomBarBgColor: c })"
                    class="scale-60 origin-left"
                />
                <div class="flex items-center gap-2">
                    <input
                        class="retro-input w-24"
                        type="text"
                        spellcheck="false"
                        maxlength="9"
                        placeholder="#RRGGBB"
                        v-model="localHex.bottomBarBgColor"
                        @input="onHexInput('bottomBarBgColor')"
                        :disabled="!settings.customBgColorsEnabled"
                        aria-label="Bottom bar background hex color"
                    />
                    <button
                        type="button"
                        class="retro-btn-copy"
                        @click="copyColor('bottomBarBgColor')"
                        :disabled="
                            !settings.customBgColorsEnabled ||
                            !settings.bottomBarBgColor.startsWith('#')
                        "
                        aria-label="Copy bottom bar color"
                        title="Copy"
                    >
                        Copy
                    </button>
                </div>
            </div>
        </section>

        <!-- Reset -->
        <section
            class="section-card space-y-3"
            role="group"
            aria-labelledby="theme-section-reset"
        >
            <h2
                id="theme-section-reset"
                class="font-heading text-base uppercase tracking-wide group-heading"
            >
                Reset
            </h2>
            <UButton
                size="sm"
                variant="basic"
                class="retro-btn px-3 py-2 text-xs"
                @click="onResetAll"
            >
                Reset All
            </UButton>
        </section>
    </div>
</template>

<script setup lang="ts">
import { reactive, watch, onBeforeUnmount, ref, computed } from 'vue';
import { createOrRefFile } from '~/db/files';
import { getFileBlob } from '~/db/files';
// Relative import (no alias friction inside /app)
import { useThemeSettings } from '~/composables/useThemeSettings';
import type { ThemeSettings } from '~/composables/theme-types';
import type { Ref } from 'vue';

const themeApi = useThemeSettings();
const settings = themeApi.settings as Ref<ThemeSettings>; // active mode settings
const set = themeApi.set;
const reset = themeApi.reset; // resets active mode by default
const resetAll = themeApi.resetAll;
const reapply = themeApi.reapply;
const activeMode = themeApi.activeMode;
const switchMode = themeApi.switchMode;

// Local mutable copy for debounced slider interactions
const local = reactive({
    baseFontPx: settings.value.baseFontPx,
    contentBg1Opacity: settings.value.contentBg1Opacity,
    contentBg2Opacity: settings.value.contentBg2Opacity,
    sidebarBgOpacity: settings.value.sidebarBgOpacity,
    contentBg1SizePx: settings.value.contentBg1SizePx,
    contentBg2SizePx: settings.value.contentBg2SizePx,
    sidebarBgSizePx: (settings.value as any).sidebarBgSizePx || 240,
});

// Local hex color text boxes (so user can type partial values without reverting)
const localHex = reactive({
    contentBg1Color: settings.value.contentBg1Color.startsWith('#')
        ? settings.value.contentBg1Color
        : '',
    contentBg2Color: settings.value.contentBg2Color.startsWith('#')
        ? settings.value.contentBg2Color
        : '',
    sidebarBgColor: settings.value.sidebarBgColor.startsWith('#')
        ? settings.value.sidebarBgColor
        : '',
    headerBgColor: settings.value.headerBgColor.startsWith('#')
        ? settings.value.headerBgColor
        : '',
    bottomBarBgColor: settings.value.bottomBarBgColor.startsWith('#')
        ? settings.value.bottomBarBgColor
        : '',
    // palette hex boxes
    palettePrimary: String(
        (settings.value as any).palettePrimary || ''
    ).startsWith('#')
        ? String((settings.value as any).palettePrimary)
        : '',
    paletteSecondary: String(
        (settings.value as any).paletteSecondary || ''
    ).startsWith('#')
        ? String((settings.value as any).paletteSecondary)
        : '',
    paletteError: String((settings.value as any).paletteError || '').startsWith(
        '#'
    )
        ? String((settings.value as any).paletteError)
        : '',
    paletteBorder: String(
        (settings.value as any).paletteBorder || ''
    ).startsWith('#')
        ? String((settings.value as any).paletteBorder)
        : '',
    paletteSurfaceVariant: String(
        (settings.value as any).paletteSurfaceVariant || ''
    ).startsWith('#')
        ? String((settings.value as any).paletteSurfaceVariant)
        : '',
    paletteSurface: String(
        (settings.value as any).paletteSurface || ''
    ).startsWith('#')
        ? String((settings.value as any).paletteSurface)
        : '',
});

// Simple debounce helper
function debounce<T extends (...args: any[]) => void>(fn: T, wait: number) {
    let t: any;
    return (...args: any[]) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}

const commitFontSize = debounce((v: number) => set({ baseFontPx: v }), 70);
const commitOpacity = debounce((key: keyof ThemeSettings, v: number) => {
    set({ [key]: v } as any);
}, 70);

function onFontSizeRange(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    local.baseFontPx = v;
    commitFontSize(v);
}
function onOpacityRange(
    e: Event,
    key: 'contentBg1Opacity' | 'contentBg2Opacity' | 'sidebarBgOpacity'
) {
    const v = Number((e.target as HTMLInputElement).value);
    (local as any)[key] = v;
    commitOpacity(key, v);
}

function toggleRepeat(
    key:
        | 'contentRepeat'
        | 'sidebarRepeat'
        | 'contentBg1Repeat'
        | 'contentBg2Repeat'
) {
    const current = (settings.value as any)[key];
    const next = current === 'repeat' ? 'no-repeat' : 'repeat';
    set({ [key]: next } as any);
}

const commitSize = debounce(
    (
        key: 'contentBg1SizePx' | 'contentBg2SizePx' | 'sidebarBgSizePx',
        v: number
    ) => set({ [key]: v } as any),
    70
);
function onSizeRange(
    e: Event,
    key: 'contentBg1SizePx' | 'contentBg2SizePx' | 'sidebarBgSizePx'
) {
    const v = Number((e.target as HTMLInputElement).value);
    (local as any)[key] = v;
    commitSize(key, v);
}

function removeLayer(which: 'contentBg1' | 'contentBg2' | 'sidebarBg') {
    if (which === 'contentBg1') {
        set({ contentBg1: null, contentBg1Opacity: 0 });
    } else if (which === 'contentBg2') {
        set({ contentBg2: null, contentBg2Opacity: 0 });
    } else if (which === 'sidebarBg') {
        set({ sidebarBg: null, sidebarBgOpacity: 0 });
    }
}

function toggleReduceHighContrast() {
    set({
        reducePatternsInHighContrast:
            !settings.value.reducePatternsInHighContrast,
    });
    reapply();
}

const presetsContent1 = [
    { label: 'Default', src: '/bg-repeat.webp', opacity: 0.08 },
];
const presetsContent2 = [
    { label: 'Default', src: '/bg-repeat-2.webp', opacity: 0.125 },
];
const presetsSidebar = [
    { label: 'Default', src: '/sidebar-repeater.webp', opacity: 0.1 },
];

function applyPreset(
    which: 'contentBg1' | 'contentBg2' | 'sidebarBg',
    src: string,
    opacity: number
) {
    if (which === 'contentBg1')
        set({ contentBg1: src, contentBg1Opacity: opacity });
    else if (which === 'contentBg2')
        set({ contentBg2: src, contentBg2Opacity: opacity });
    else if (which === 'sidebarBg')
        set({ sidebarBg: src, sidebarBgOpacity: opacity });
}

// Cache of resolved object URLs for internal-file tokens
const internalUrlCache = new Map<string, string>();
async function resolveInternalPath(v: string | null): Promise<string | null> {
    if (!v) return null;
    if (!v.startsWith('internal-file://')) return v;
    const hash = v.slice('internal-file://'.length);
    if (internalUrlCache.has(hash)) return internalUrlCache.get(hash)!;
    try {
        const blob = await getFileBlob(hash);
        if (!blob) return null;
        const u = URL.createObjectURL(blob);
        internalUrlCache.set(hash, u);
        registerObjectUrl(u);
        return u;
    } catch {
        return null;
    }
}
function displayName(path: string | null) {
    if (!path) return '';
    if (path.startsWith('internal-file://')) return 'Saved Image';
    try {
        if (path.startsWith('blob:')) return 'Uploaded';
        const url = new URL(path, window.location.origin);
        return url.pathname.split('/').pop() || path;
    } catch {
        return path.split('/').pop() || path;
    }
}

// Reactive resolved URLs
const resolvedContentBg1 = ref<string | null>(null);
const resolvedContentBg2 = ref<string | null>(null);
const resolvedSidebarBg = ref<string | null>(null);

async function refreshResolved() {
    resolvedContentBg1.value = await resolveInternalPath(
        settings.value.contentBg1 || null
    );
    resolvedContentBg2.value = await resolveInternalPath(
        settings.value.contentBg2 || null
    );
    resolvedSidebarBg.value = await resolveInternalPath(
        settings.value.sidebarBg || null
    );
}

watch(
    () => [
        settings.value.contentBg1,
        settings.value.contentBg2,
        settings.value.sidebarBg,
    ],
    () => {
        refreshResolved();
    },
    { immediate: true }
);

const contentBg1PreviewStyle = computed(() => {
    const fit = !!settings.value.contentBg1Fit;
    const repeatEnabled = settings.value.contentBg1Repeat === 'repeat' && !fit;
    return {
        backgroundImage: resolvedContentBg1.value
            ? `url(${resolvedContentBg1.value})`
            : 'none',
        backgroundRepeat: repeatEnabled ? 'repeat' : 'no-repeat',
        backgroundSize: repeatEnabled ? '32px 32px' : fit ? 'cover' : 'contain',
        backgroundPosition: 'center',
    } as const;
});
const contentBg2PreviewStyle = computed(() => {
    const fit = !!settings.value.contentBg2Fit;
    const repeatEnabled = settings.value.contentBg2Repeat === 'repeat' && !fit;
    return {
        backgroundImage: resolvedContentBg2.value
            ? `url(${resolvedContentBg2.value})`
            : 'none',
        backgroundRepeat: repeatEnabled ? 'repeat' : 'no-repeat',
        backgroundSize: repeatEnabled ? '32px 32px' : fit ? 'cover' : 'contain',
        backgroundPosition: 'center',
    } as const;
});
const sidebarBgPreviewStyle = computed(() => {
    const fit = !!settings.value.sidebarBgFit;
    const repeatEnabled = settings.value.sidebarRepeat === 'repeat' && !fit;
    return {
        backgroundImage: resolvedSidebarBg.value
            ? `url(${resolvedSidebarBg.value})`
            : 'none',
        backgroundRepeat: repeatEnabled ? 'repeat' : 'no-repeat',
        backgroundSize: repeatEnabled ? '32px 32px' : fit ? 'cover' : 'contain',
        backgroundPosition: 'center',
    } as const;
});

function isPresetActive(
    which: 'contentBg1' | 'contentBg2' | 'sidebarBg',
    src: string
) {
    return (settings.value as any)[which] === src ? 'active' : '';
}

// Object URL lifecycle tracking
const objectUrls = new Set<string>();
function registerObjectUrl(u: string) {
    objectUrls.add(u);
}
function revokeAll() {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.clear();
}
onBeforeUnmount(revokeAll);

// Minimal notify (console only for now; integrate with existing toast system later)
const liveStatus = ref<HTMLElement | null>(null);
// Drag & file input state for drop zones
const dragOver = reactive({
    contentBg1: false,
    contentBg2: false,
    sidebarBg: false,
});
const fileInputs = reactive<Record<string, HTMLInputElement | null>>({
    contentBg1: null,
    contentBg2: null,
    sidebarBg: null,
});

function openFile(which: 'contentBg1' | 'contentBg2' | 'sidebarBg') {
    const el = fileInputs[which];
    if (el) el.click();
}
function onDragEnter(
    _e: DragEvent,
    which: 'contentBg1' | 'contentBg2' | 'sidebarBg'
) {
    dragOver[which] = true;
}
function onDragOver(_e: DragEvent) {
    /* keep default prevented in template */
}
function onDragLeave(
    _e: DragEvent,
    which: 'contentBg1' | 'contentBg2' | 'sidebarBg'
) {
    dragOver[which] = false;
}
async function onDrop(
    e: DragEvent,
    which: 'contentBg1' | 'contentBg2' | 'sidebarBg'
) {
    dragOver[which] = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    await onUpload(
        { target: { files: [file], value: '' } } as any as Event,
        which
    );
}

function notify(title: string, description?: string) {
    console.warn('[theme-settings]', title, description || '');
    if (liveStatus.value) {
        liveStatus.value.textContent = description
            ? `${title}: ${description}`
            : title;
    }
}

async function onUpload(
    ev: Event,
    which: 'contentBg1' | 'contentBg2' | 'sidebarBg'
) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
        if (!file.type.startsWith('image/')) {
            notify('Invalid image type');
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            notify('Image too large', 'Max 2MB');
            return;
        }
        // Persist via file store (dedup by content hash)
        const meta = await createOrRefFile(file, file.name || 'upload');
        // Store as synthetic scheme so we can resolve later
        const token = `internal-file://${meta.hash}`;
        if (which === 'contentBg1') set({ contentBg1: token });
        else if (which === 'contentBg2') set({ contentBg2: token });
        else if (which === 'sidebarBg') set({ sidebarBg: token });
        notify('Background image saved', meta.hash.slice(0, 8));
    } catch (e: any) {
        notify('Upload failed', e?.message || 'unknown error');
    } finally {
        if (input) input.value = '';
    }
}

function onResetAll() {
    if (confirm('Reset BOTH light and dark theme settings to defaults?')) {
        resetAll();
    }
}

function onResetCurrent() {
    if (confirm(`Reset ${activeMode.value} theme settings to defaults?`)) {
        reset();
    }
}

// Hex handling helpers
function isValidHex(v: string) {
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
        v
    );
}
function ensureHash(v: string) {
    return v.startsWith('#') ? v : `#${v}`;
}
function onHexInput(key: keyof typeof localHex) {
    const raw = (localHex as any)[key];
    if (!raw) return; // allow clearing without committing
    const candidate = ensureHash(raw.trim());
    if (isValidHex(candidate)) {
        set({ [key]: candidate.toLowerCase() } as any);
    }
}
async function copyColor(key: keyof typeof localHex) {
    const val = (settings.value as any)[key];
    if (!val || !val.startsWith('#')) return;
    try {
        await navigator.clipboard.writeText(val);
        notify('Copied color', val);
    } catch {
        notify('Copy failed');
    }
}

// Keep local reactive sliders synced if external reset or future import occurs
watch(
    settings,
    (s) => {
        if (!s) return;
        local.baseFontPx = s.baseFontPx;
        local.contentBg1Opacity = s.contentBg1Opacity;
        local.contentBg2Opacity = s.contentBg2Opacity;
        local.sidebarBgOpacity = s.sidebarBgOpacity;
        local.contentBg1SizePx = s.contentBg1SizePx;
        local.contentBg2SizePx = s.contentBg2SizePx;
        local.sidebarBgSizePx = (s as any).sidebarBgSizePx || 240;
        // sync hex boxes (only show hex values)
        localHex.contentBg1Color = s.contentBg1Color.startsWith('#')
            ? s.contentBg1Color
            : '';
        localHex.contentBg2Color = s.contentBg2Color.startsWith('#')
            ? s.contentBg2Color
            : '';
        localHex.sidebarBgColor = s.sidebarBgColor.startsWith('#')
            ? s.sidebarBgColor
            : '';
        localHex.headerBgColor = s.headerBgColor.startsWith('#')
            ? s.headerBgColor
            : '';
        localHex.bottomBarBgColor = s.bottomBarBgColor.startsWith('#')
            ? s.bottomBarBgColor
            : '';
        // palette hex boxes
        (localHex as any).palettePrimary = String(
            (s as any).palettePrimary || ''
        ).startsWith('#')
            ? String((s as any).palettePrimary)
            : '';
        (localHex as any).paletteSecondary = String(
            (s as any).paletteSecondary || ''
        ).startsWith('#')
            ? String((s as any).paletteSecondary)
            : '';
        (localHex as any).paletteError = String(
            (s as any).paletteError || ''
        ).startsWith('#')
            ? String((s as any).paletteError)
            : '';
        (localHex as any).paletteSurfaceVariant = String(
            (s as any).paletteSurfaceVariant || ''
        ).startsWith('#')
            ? String((s as any).paletteSurfaceVariant)
            : '';
        (localHex as any).paletteBorder = String(
            (s as any).paletteBorder || ''
        ).startsWith('#')
            ? String((s as any).paletteBorder)
            : '';
        (localHex as any).paletteSurface = String(
            (s as any).paletteSurface || ''
        ).startsWith('#')
            ? String((s as any).paletteSurface)
            : '';
    },
    { deep: true }
);
</script>

<style scoped>
.section-card {
    position: relative;
    padding: 1.25rem 1rem 1rem 1rem; /* MD3 dense card spacing */
    border: 2px solid var(--md-inverse-surface);
    background: linear-gradient(
        var(--md-surface) 0%,
        var(--md-surface-variant) 140%
    );
    border-radius: 6px;
    box-shadow: 2px 2px 0 var(--md-inverse-surface);
}
/* Removed previous focus-within outline on entire section */
.group-heading {
    margin-top: -0.25rem; /* optical align */
    letter-spacing: 0.08em;
}
.supporting-text {
    font-size: 10px;
    line-height: 1.2;
    max-width: 56ch;
    color: var(--md-on-surface-variant, var(--md-on-surface));
    opacity: 0.7;
}
.fallback-row {
    flex-wrap: wrap;
}
.fallback-row > label {
    flex: 0 0 120px;
}
.fallback-row .retro-input {
    width: 92px;
}
@media (max-width: 560px) {
    .fallback-row {
        align-items: flex-start;
    }
    .fallback-row > label {
        width: 100%;
        margin-bottom: 4px;
    }
    .fallback-row .retro-input {
        width: 100px;
    }
}
.drop-zone {
    position: relative;
    overflow: hidden;
    cursor: pointer;
}
.drop-zone:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
}
.drop-zone.is-dragover {
    outline: 2px dashed var(--md-primary);
    outline-offset: 2px;
}
.drop-zone .dz-hint {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 600;
    /* Stronger scrim for readability over any image */
    background: linear-gradient(rgba(0, 0, 0, 0.58), rgba(0, 0, 0, 0.58));
    color: #fff;
    opacity: 0;
    transition: opacity 0.18s ease;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(0, 0, 0, 0.9);
    -webkit-text-stroke: 0.25px rgba(0, 0, 0, 0.6);
    backdrop-filter: brightness(0.85) saturate(0.9) contrast(1.15);
    /* Fallback if backdrop-filter unsupported */
    mix-blend-mode: normal;
}
.drop-zone:is(:hover, :focus-visible, .is-dragover) .dz-hint {
    opacity: 1;
}

.pattern-thumb {
    width: 150px;
    height: 150px;
    border: 2px solid var(--md-inverse-surface);
    box-shadow: 2px 2px 0 var(--md-inverse-surface);
    background-color: var(--md-surface-variant);
    background-size: 32px 32px;
    image-rendering: pixelated;
}

.fallback-row .retro-input {
    width: 92px;
}
@media (prefers-reduced-motion: reduce) {
    .section-card,
    .drop-zone .dz-hint {
        transition: none;
    }
}
</style>
