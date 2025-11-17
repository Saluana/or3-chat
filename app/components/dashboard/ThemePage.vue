<template>
    <!-- Root no longer forces full height or its own scroll; parent provides scroll container -->
    <div
        id="dashboard-theme-page-container"
        class="px-4 py-4 space-y-12 text-sm"
    >
        <!-- Accessible live region for status updates -->
        <p ref="liveStatus" class="sr-only" aria-live="polite"></p>
        <!-- Mode Toggle -->
        <section
            id="dashboard-theme-mode-section"
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
                        v-bind="themeModeButtonProps"
                        :class="activeMode === 'light' ? 'active' : ''"
                        :disabled="activeMode === 'light'"
                        :aria-pressed="activeMode === 'light'"
                        @click="switchMode('light')"
                        >Light</UButton
                    >
                    <UButton
                        v-bind="themeModeButtonProps"
                        :class="activeMode === 'dark' ? 'active' : ''"
                        :disabled="activeMode === 'dark'"
                        :aria-pressed="activeMode === 'dark'"
                        @click="switchMode('dark')"
                        >Dark</UButton
                    >
                    <UButton
                        v-bind="themeModeButtonProps"
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
            id="dashboard-theme-palette-section"
            class="section-card space-y-4"
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
                Override Material Design 3 colors for this mode. Toggle off to
                use theme defaults.
            </p>
            <label class="flex items-center gap-2 cursor-pointer select-none">
                <input
                    type="checkbox"
                    :checked="overrides.colors?.enabled ?? false"
                    @change="togglePaletteOverrides"
                />
                <span class="text-xs">Enable palette overrides</span>
            </label>

            <div
                v-for="group in colorGroups"
                :key="group.label"
                class="space-y-2 pt-2"
            >
                <h3 class="text-xs font-semibold opacity-70">
                    {{ group.label }}
                </h3>
                <div class="space-y-3 pl-2">
                    <div
                        v-for="color in group.colors"
                        :key="color.key"
                        class="flex items-start gap-2 flex-wrap sm:flex-nowrap sm:items-center"
                    >
                        <label class="w-full sm:w-40 text-xs pt-2 sm:pt-0">{{
                            color.label
                        }}</label>
                        <div
                            class="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto"
                        >
                            <UColorPicker
                                v-bind="paletteColorPickerProps"
                                :disabled="
                                    !(overrides.colors?.enabled ?? false)
                                "
                                :model-value="
                                    (overrides.colors?.enabled ?? false) &&
                                    String((overrides.colors as any)?.[color.key] || '').startsWith('#')
                                        ? (overrides.colors as any)[color.key]
                                        : undefined
                                "
                                @update:model-value="(c: string | undefined) => { if (c) set({ colors: { [color.key]: c } } as any); }"
                                class="scale-60 origin-left shrink-0"
                            />
                            <!-- Hex input + copy button row (inline both mobile & desktop) -->
                            <div
                                class="flex items-center gap-2 w-full sm:w-auto"
                            >
                                <UInput
                                    v-bind="hexInputProps"
                                    class="flex-1 sm:w-24 h-8"
                                    type="text"
                                    :placeholder="'#RRGGBB'"
                                    :model-value="(localHex as any)[color.key]"
                                    @update:model-value="(v: any) => { (localHex as any)[color.key] = String(v ?? ''); onHexInput(color.key as any); }"
                                    :disabled="
                                        !(overrides.colors?.enabled ?? false)
                                    "
                                    :aria-label="`${color.label} hex color`"
                                />
                                <UButton
                                    v-bind="copyButtonProps"
                                    class="shrink-0"
                                    :disabled="
                                        !(overrides.colors?.enabled ?? false) ||
                                        !String((overrides.colors as any)?.[color.key] || '').startsWith('#')
                                    "
                                    :aria-label="`Copy ${color.label}`"
                                    :title="`Copy ${color.label}`"
                                    @click="copyColor(color.key as any)"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
        <!-- Custom Background Colors Master Toggle -->
        <section
            id="dashboard-theme-custom-backgrounds-section"
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
                    :checked="overrides.backgrounds?.enabled ?? false"
                    @change="
                        set({
                            backgrounds: {
                                enabled: !(
                                    overrides.backgrounds?.enabled ?? false
                                ),
                            },
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
                v-if="!(overrides.backgrounds?.enabled ?? false)"
            >
                Disabled: system/theme background colors shown.
            </p>
            <p class="text-xs opacity-70" v-else>
                Enabled: custom values below override system backgrounds.
            </p>
        </section>
        <!-- Typography -->
        <section
            id="dashboard-theme-typography-section"
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
                    :checked="overrides.typography?.useSystemFont ?? false"
                    @change="
                        set({
                            typography: {
                                useSystemFont: !(
                                    overrides.typography?.useSystemFont ?? false
                                ),
                            },
                        })
                    "
                />
                <span class="text-xs">Use system font for body & headings</span>
            </label>
        </section>

        <!-- Content Background Layer 1 -->
        <section
            id="dashboard-theme-content-layer1-section"
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
                        !contentBg1Url || local.contentBg1Opacity === 0
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
                    class="text-xs truncate max-w-40"
                    :title="displayName(contentBg1Url)"
                >
                    {{ contentBg1Url ? displayName(contentBg1Url) : 'None' }}
                </span>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <span class="text-xs opacity-70">Presets:</span>
                <UButton
                    v-bind="presetButtonProps"
                    v-for="p in presetsContent1"
                    :key="p.src"
                    @click="applyPreset('contentBg1', p.src, p.opacity)"
                    :class="isPresetActive('contentBg1', p.src)"
                >
                    {{ p.label }}
                </UButton>
                <UButton
                    v-bind="removeLayerButtonProps"
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
                    v-bind="repeatButtonProps"
                    @click="toggleRepeat('contentBg1Repeat')"
                    :aria-pressed="contentBg1Repeat === 'repeat'"
                >
                    Repeat:
                    {{ contentBg1Repeat === 'repeat' ? 'On' : 'Off' }}
                </UButton>
                <label
                    class="flex items-center gap-1 text-[10px] cursor-pointer select-none"
                >
                    <input
                        type="checkbox"
                        :checked="contentBg1Fit"
                        @change="
                            set({
                                backgrounds: {
                                    content: { base: { fit: !contentBg1Fit } },
                                },
                            })
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
                    :disabled="contentBg1Fit"
                    :value="local.contentBg1SizePx"
                    @input="onSizeRange($event, 'contentBg1SizePx')"
                    class="flex-1"
                />
                <span class="w-16 text-right tabular-nums text-xs">{{
                    contentBg1Fit ? 'cover' : local.contentBg1SizePx + 'px'
                }}</span>
            </div>
            <div class="flex items-start gap-4 fallback-row">
                <label class="w-32 text-xs pt-2">Fallback Color</label>
                <div class="flex flex-col gap-2 w-full sm:w-auto">
                    <UColorPicker
                        v-bind="backgroundColorPickerProps"
                        :disabled="!bgEnabled"
                        :model-value="
                            bgEnabled && contentBg1Color.startsWith('#')
                                ? contentBg1Color
                                : undefined
                        "
                        @update:model-value="(c: string | undefined)=> c && set({ backgrounds: { content: { base: { color: c } } } })"
                        class="scale-60 origin-left"
                    />
                    <div class="flex items-center gap-2">
                        <UInput
                            v-bind="hexInputProps"
                            class="flex-1 sm:w-24 h-8"
                            type="text"
                            :placeholder="'#RRGGBB'"
                            :model-value="localHex.contentBg1Color"
                            @update:model-value="(v:any)=>{ localHex.contentBg1Color = String(v ?? ''); onHexInput('contentBg1Color'); }"
                            :disabled="!bgEnabled"
                            aria-label="Content layer 1 fallback hex color"
                        />
                        <UButton
                            v-bind="copyButtonProps"
                            class="shrink-0"
                            @click="copyColor('contentBg1Color')"
                            :disabled="
                                !bgEnabled || !contentBg1Color.startsWith('#')
                            "
                            aria-label="Copy content layer 1 color"
                            title="Copy content layer 1 color"
                        />
                    </div>
                </div>
            </div>
        </section>

        <!-- Content Background Layer 2 -->
        <section
            id="dashboard-theme-content-layer2-section"
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
                        !contentBg2Url || local.contentBg2Opacity === 0
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
                    class="text-xs truncate max-w-40"
                    :title="displayName(contentBg2Url)"
                >
                    {{
                        contentBg2Url ? displayName(contentBg2Url) : 'Disabled'
                    }}
                </span>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <span class="text-xs opacity-70">Presets:</span>
                <UButton
                    v-bind="presetButtonProps"
                    v-for="p in presetsContent2"
                    :key="p.src"
                    @click="applyPreset('contentBg2', p.src, p.opacity)"
                    :class="isPresetActive('contentBg2', p.src)"
                >
                    {{ p.label }}
                </UButton>
                <UButton
                    v-bind="removeLayerButtonProps"
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
                    v-bind="repeatButtonProps"
                    @click="toggleRepeat('contentBg2Repeat')"
                    :aria-pressed="contentBg2Repeat === 'repeat'"
                >
                    Repeat:
                    {{ contentBg2Repeat === 'repeat' ? 'On' : 'Off' }}
                </UButton>
                <label
                    class="flex items-center gap-1 text-[10px] cursor-pointer select-none"
                >
                    <input
                        type="checkbox"
                        :checked="contentBg2Fit"
                        @change="
                            set({
                                backgrounds: {
                                    content: {
                                        overlay: { fit: !contentBg2Fit },
                                    },
                                },
                            })
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
                    :disabled="contentBg2Fit"
                    :value="local.contentBg2SizePx"
                    @input="onSizeRange($event, 'contentBg2SizePx')"
                    class="flex-1"
                />
                <span class="w-16 text-right tabular-nums text-xs">{{
                    contentBg2Fit ? 'cover' : local.contentBg2SizePx + 'px'
                }}</span>
            </div>
            <div class="flex items-start gap-4 fallback-row">
                <label class="w-32 text-xs pt-2">Fallback Color</label>
                <div class="flex flex-col gap-2 w-full sm:w-auto">
                    <UColorPicker
                        v-bind="backgroundColorPickerProps"
                        :disabled="!bgEnabled"
                        :model-value="
                            bgEnabled && contentBg2Color.startsWith('#')
                                ? contentBg2Color
                                : undefined
                        "
                        @update:model-value="(c: string | undefined)=> c && set({ backgrounds: { content: { overlay: { color: c } } } })"
                        class="scale-60 origin-left"
                    />
                    <div class="flex items-center gap-2">
                        <UInput
                            v-bind="hexInputProps"
                            class="flex-1 sm:w-24 h-8"
                            type="text"
                            :placeholder="'#RRGGBB'"
                            :model-value="localHex.contentBg2Color"
                            @update:model-value="(v:any)=>{ localHex.contentBg2Color = String(v ?? ''); onHexInput('contentBg2Color'); }"
                            :disabled="!bgEnabled"
                            aria-label="Content layer 2 fallback hex color"
                        />
                        <UButton
                            v-bind="copyButtonProps"
                            class="shrink-0"
                            @click="copyColor('contentBg2Color')"
                            :disabled="
                                !bgEnabled || !contentBg2Color.startsWith('#')
                            "
                            aria-label="Copy content layer 2 color"
                            title="Copy content layer 2 color"
                        />
                    </div>
                </div>
            </div>
        </section>

        <!-- Sidebar Background -->
        <section
            id="dashboard-theme-sidebar-section"
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
                        !sidebarBgUrl || local.sidebarBgOpacity === 0
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
                    class="text-xs truncate max-w-40"
                    :title="displayName(sidebarBgUrl)"
                >
                    {{ sidebarBgUrl ? displayName(sidebarBgUrl) : 'None' }}
                </span>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
                <span class="text-xs opacity-70">Presets:</span>
                <UButton
                    v-bind="presetButtonProps"
                    v-for="p in presetsSidebar"
                    :key="p.src"
                    @click="applyPreset('sidebarBg', p.src, p.opacity)"
                    :class="isPresetActive('sidebarBg', p.src)"
                >
                    {{ p.label }}
                </UButton>
                <UButton
                    v-bind="removeLayerButtonProps"
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
                    v-bind="repeatButtonProps"
                    @click="toggleRepeat('sidebarRepeat')"
                    :aria-pressed="sidebarRepeat === 'repeat'"
                >
                    Repeat:
                    {{ sidebarRepeat === 'repeat' ? 'On' : 'Off' }}
                </UButton>
                <label
                    class="flex items-center gap-1 text-[10px] cursor-pointer select-none"
                >
                    <input
                        type="checkbox"
                        :checked="sidebarBgFit"
                        @change="
                            set({
                                backgrounds: {
                                    sidebar: { fit: !sidebarBgFit },
                                },
                            })
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
                    :disabled="sidebarBgFit"
                    :value="local.sidebarBgSizePx"
                    @input="onSizeRange($event, 'sidebarBgSizePx')"
                    class="flex-1"
                />
                <span class="w-16 text-right tabular-nums text-xs">{{
                    sidebarBgFit ? 'cover' : local.sidebarBgSizePx + 'px'
                }}</span>
            </div>
            <div class="flex items-start gap-4 fallback-row">
                <label class="w-32 text-xs pt-2">Fallback Color</label>
                <div class="flex flex-col gap-2 w-full sm:w-auto">
                    <UColorPicker
                        v-bind="backgroundColorPickerProps"
                        :disabled="!bgEnabled"
                        :model-value="
                            bgEnabled && sidebarBgColor.startsWith('#')
                                ? sidebarBgColor
                                : undefined
                        "
                        @update:model-value="(c: string | undefined)=> c && set({ backgrounds: { sidebar: { color: c } } })"
                        class="scale-60 origin-left"
                    />
                    <div class="flex items-center gap-2">
                        <UInput
                            v-bind="hexInputProps"
                            class="flex-1 sm:w-24 h-8"
                            type="text"
                            :placeholder="'#RRGGBB'"
                            :model-value="localHex.sidebarBgColor"
                            @update:model-value="(v:any)=>{ localHex.sidebarBgColor = String(v ?? ''); onHexInput('sidebarBgColor'); }"
                            :disabled="!bgEnabled"
                            aria-label="Sidebar fallback hex color"
                        />
                        <UButton
                            v-bind="copyButtonProps"
                            class="shrink-0"
                            @click="copyColor('sidebarBgColor')"
                            :disabled="
                                !bgEnabled || !sidebarBgColor.startsWith('#')
                            "
                            aria-label="Copy sidebar color"
                            title="Copy sidebar color"
                        />
                    </div>
                </div>
            </div>
        </section>

        <!-- Accessibility -->
        <section
            id="dashboard-theme-accessibility-section"
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
                    :checked="
                        overrides.ui?.reducePatternsInHighContrast ?? false
                    "
                    @change="toggleReduceHighContrast"
                />
                <span class="text-xs"
                    >Reduce pattern opacity in high contrast modes</span
                >
            </label>
        </section>

        <!-- Reset -->
        <section
            id="dashboard-theme-reset-section"
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
                v-bind="resetAllButtonProps"
                class="px-3 py-2 text-xs"
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
// Import new user overrides composable
import { useUserThemeOverrides } from '~/core/theme/useUserThemeOverrides';
import type { UserThemeOverrides } from '~/core/theme/user-overrides-types';
import type { Ref } from 'vue';
import { useThemeOverrides } from '~/composables/useThemeResolver';

const themeApi = useUserThemeOverrides();
const overrides = themeApi.overrides as Ref<UserThemeOverrides>; // active mode overrides
const set = themeApi.set;
const reset = themeApi.reset; // resets active mode by default
const resetAll = themeApi.resetAll;
const reapply = themeApi.reapply;
const activeMode = themeApi.activeMode;
const switchMode = themeApi.switchMode;

// Helper to get current color from CSS variables (base theme)
function getCurrentThemeColor(cssVar: string): string {
    if (!isBrowser()) return '';
    const computed = getComputedStyle(document.documentElement);
    const value = computed.getPropertyValue(cssVar).trim();
    // Convert rgb(r, g, b) or rgb(r g b) to hex
    if (value.startsWith('rgb')) {
        // Handle both "rgb(r, g, b)" and "rgb(r g b)" formats
        const match = value.match(/rgb\((\d+)[,\s]+(\d+)[,\s]+(\d+)\)/);
        if (match && match[1] && match[2] && match[3]) {
            const r = parseInt(match[1], 10);
            const g = parseInt(match[2], 10);
            const b = parseInt(match[3], 10);
            return (
                '#' +
                ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
            );
        }
    }
    return value.startsWith('#') ? value : '';
}

const isBrowser = () => typeof window !== 'undefined';

// Helper to read url(...) from CSS custom properties and normalize to an absolute path
function getCssVarUrl(cssVar: string): string | null {
    if (!isBrowser()) return null;
    const computed = getComputedStyle(document.documentElement);
    const value = computed.getPropertyValue(cssVar).trim();
    if (!value) return null;
    // Match url("/path") or url(/path) or url(../path)
    const m = value.match(/url\((['"]?)(.*?)\1\)/);
    const raw = m?.[2];
    if (!raw) return null;
    try {
        const u = new URL(raw, window.location.origin);
        return u.pathname + u.search + u.hash;
    } catch {
        // Fallback to raw when URL constructor fails (should still work for absolute paths)
        return raw;
    }
}

// Color groups for organized UI
const colorGroups = [
    {
        label: 'Primary Colors',
        colors: [
            { key: 'primary', label: 'Primary' },
            { key: 'onPrimary', label: 'On Primary' },
            { key: 'primaryContainer', label: 'Primary Container' },
            { key: 'onPrimaryContainer', label: 'On Primary Container' },
        ],
    },
    {
        label: 'Secondary Colors',
        colors: [
            { key: 'secondary', label: 'Secondary' },
            { key: 'onSecondary', label: 'On Secondary' },
            { key: 'secondaryContainer', label: 'Secondary Container' },
            { key: 'onSecondaryContainer', label: 'On Secondary Container' },
        ],
    },
    {
        label: 'Tertiary Colors',
        colors: [
            { key: 'tertiary', label: 'Tertiary' },
            { key: 'onTertiary', label: 'On Tertiary' },
            { key: 'tertiaryContainer', label: 'Tertiary Container' },
            { key: 'onTertiaryContainer', label: 'On Tertiary Container' },
        ],
    },
    {
        label: 'Error Colors',
        colors: [
            { key: 'error', label: 'Error' },
            { key: 'onError', label: 'On Error' },
            { key: 'errorContainer', label: 'Error Container' },
            { key: 'onErrorContainer', label: 'On Error Container' },
        ],
    },
    {
        label: 'Surface Colors',
        colors: [
            { key: 'surface', label: 'Surface' },
            { key: 'onSurface', label: 'On Surface' },
            { key: 'surfaceVariant', label: 'Surface Variant' },
            { key: 'onSurfaceVariant', label: 'On Surface Variant' },
            { key: 'inverseSurface', label: 'Inverse Surface' },
            { key: 'inverseOnSurface', label: 'Inverse On Surface' },
        ],
    },
    {
        label: 'Outline',
        colors: [
            { key: 'outline', label: 'Outline' },
            { key: 'outlineVariant', label: 'Outline Variant' },
        ],
    },
    {
        label: 'Semantic Colors',
        colors: [
            { key: 'success', label: 'Success' },
            { key: 'warning', label: 'Warning' },
        ],
    },
];

// Computed helpers for cleaner template bindings
const bgEnabled = computed(() => overrides.value.backgrounds?.enabled ?? false);
const contentBg1Url = computed(
    () => overrides.value.backgrounds?.content?.base?.url || null
);
const contentBg1Repeat = computed(
    () => overrides.value.backgrounds?.content?.base?.repeat || 'repeat'
);
const contentBg1Fit = computed(
    () => overrides.value.backgrounds?.content?.base?.fit ?? false
);
const contentBg1Color = computed(
    () => overrides.value.backgrounds?.content?.base?.color || ''
);
const contentBg2Url = computed(
    () => overrides.value.backgrounds?.content?.overlay?.url || null
);
const contentBg2Repeat = computed(
    () => overrides.value.backgrounds?.content?.overlay?.repeat || 'repeat'
);
const contentBg2Fit = computed(
    () => overrides.value.backgrounds?.content?.overlay?.fit ?? false
);
const contentBg2Color = computed(
    () => overrides.value.backgrounds?.content?.overlay?.color || ''
);
const sidebarBgUrl = computed(
    () => overrides.value.backgrounds?.sidebar?.url || null
);
const sidebarRepeat = computed(
    () => overrides.value.backgrounds?.sidebar?.repeat || 'repeat'
);
const sidebarBgFit = computed(
    () => overrides.value.backgrounds?.sidebar?.fit ?? false
);
const sidebarBgColor = computed(
    () => overrides.value.backgrounds?.sidebar?.color || ''
);

// Theme overrides for buttons
const themeModeButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.mode',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
    };
});

const presetButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.preset',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
    };
});

const removeLayerButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.remove-layer',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
    };
});

const repeatButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.repeat',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
    };
});

const paletteColorPickerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'color-picker',
        context: 'dashboard',
        identifier: 'dashboard.theme.palette-picker',
        isNuxtUI: true,
    });
    return overrides.value || {};
});

const backgroundColorPickerProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'color-picker',
        context: 'dashboard',
        identifier: 'dashboard.theme.background-picker',
        isNuxtUI: true,
    });
    return overrides.value || {};
});

const resetAllButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.reset-all',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        color: 'on-surface' as const,
        ...(overrides.value as any),
    };
});

const copyButtonProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'button',
        context: 'dashboard',
        identifier: 'dashboard.theme.copy-color',
        isNuxtUI: true,
    });
    return {
        size: 'sm' as const,
        variant: 'ghost' as const,
        icon: 'pixelarticons:copy' as const,
        square: true,
        ...(overrides.value as any),
    };
});

// Hex input styling via theme system (Nuxt UI input component)
const hexInputProps = computed(() => {
    const overrides = useThemeOverrides({
        component: 'input',
        context: 'dashboard',
        identifier: 'dashboard.theme.hex-input',
        isNuxtUI: true,
    });
    // Provide minimal defaults; theme can override class/variant/size
    return {
        size: 'sm' as const,
        variant: 'outline' as const,
        ...(overrides.value as any),
    };
});

// Local mutable copy for debounced slider interactions
const local = reactive({
    baseFontPx: overrides.value.typography?.baseFontPx || 20,
    contentBg1Opacity: overrides.value.backgrounds?.content?.base?.opacity || 0,
    contentBg2Opacity:
        overrides.value.backgrounds?.content?.overlay?.opacity || 0,
    sidebarBgOpacity: overrides.value.backgrounds?.sidebar?.opacity || 0,
    contentBg1SizePx: overrides.value.backgrounds?.content?.base?.sizePx || 240,
    contentBg2SizePx:
        overrides.value.backgrounds?.content?.overlay?.sizePx || 240,
    sidebarBgSizePx: overrides.value.backgrounds?.sidebar?.sizePx || 240,
});

// Local hex color text boxes (so user can type partial values without reverting)
const localHex = reactive({
    contentBg1Color: String(
        overrides.value.backgrounds?.content?.base?.color || ''
    ).startsWith('#')
        ? String(overrides.value.backgrounds?.content?.base?.color)
        : '',
    contentBg2Color: String(
        overrides.value.backgrounds?.content?.overlay?.color || ''
    ).startsWith('#')
        ? String(overrides.value.backgrounds?.content?.overlay?.color)
        : '',
    sidebarBgColor: String(
        overrides.value.backgrounds?.sidebar?.color || ''
    ).startsWith('#')
        ? String(overrides.value.backgrounds?.sidebar?.color)
        : '',
    // Material Design palette hex boxes (expanded to support all MD3 colors)
    primary: String(overrides.value.colors?.primary || '').startsWith('#')
        ? String(overrides.value.colors?.primary)
        : '',
    onPrimary: String(overrides.value.colors?.onPrimary || '').startsWith('#')
        ? String(overrides.value.colors?.onPrimary)
        : '',
    primaryContainer: String(
        overrides.value.colors?.primaryContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.primaryContainer)
        : '',
    onPrimaryContainer: String(
        overrides.value.colors?.onPrimaryContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.onPrimaryContainer)
        : '',
    secondary: String(overrides.value.colors?.secondary || '').startsWith('#')
        ? String(overrides.value.colors?.secondary)
        : '',
    onSecondary: String(overrides.value.colors?.onSecondary || '').startsWith(
        '#'
    )
        ? String(overrides.value.colors?.onSecondary)
        : '',
    secondaryContainer: String(
        overrides.value.colors?.secondaryContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.secondaryContainer)
        : '',
    onSecondaryContainer: String(
        overrides.value.colors?.onSecondaryContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.onSecondaryContainer)
        : '',
    tertiary: String(overrides.value.colors?.tertiary || '').startsWith('#')
        ? String(overrides.value.colors?.tertiary)
        : '',
    onTertiary: String(overrides.value.colors?.onTertiary || '').startsWith('#')
        ? String(overrides.value.colors?.onTertiary)
        : '',
    tertiaryContainer: String(
        overrides.value.colors?.tertiaryContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.tertiaryContainer)
        : '',
    onTertiaryContainer: String(
        overrides.value.colors?.onTertiaryContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.onTertiaryContainer)
        : '',
    error: String(overrides.value.colors?.error || '').startsWith('#')
        ? String(overrides.value.colors?.error)
        : '',
    onError: String(overrides.value.colors?.onError || '').startsWith('#')
        ? String(overrides.value.colors?.onError)
        : '',
    errorContainer: String(
        overrides.value.colors?.errorContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.errorContainer)
        : '',
    onErrorContainer: String(
        overrides.value.colors?.onErrorContainer || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.onErrorContainer)
        : '',
    surface: String(overrides.value.colors?.surface || '').startsWith('#')
        ? String(overrides.value.colors?.surface)
        : '',
    onSurface: String(overrides.value.colors?.onSurface || '').startsWith('#')
        ? String(overrides.value.colors?.onSurface)
        : '',
    surfaceVariant: String(
        overrides.value.colors?.surfaceVariant || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.surfaceVariant)
        : '',
    onSurfaceVariant: String(
        overrides.value.colors?.onSurfaceVariant || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.onSurfaceVariant)
        : '',
    inverseSurface: String(
        overrides.value.colors?.inverseSurface || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.inverseSurface)
        : '',
    inverseOnSurface: String(
        overrides.value.colors?.inverseOnSurface || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.inverseOnSurface)
        : '',
    outline: String(overrides.value.colors?.outline || '').startsWith('#')
        ? String(overrides.value.colors?.outline)
        : '',
    outlineVariant: String(
        overrides.value.colors?.outlineVariant || ''
    ).startsWith('#')
        ? String(overrides.value.colors?.outlineVariant)
        : '',
    success: String(overrides.value.colors?.success || '').startsWith('#')
        ? String(overrides.value.colors?.success)
        : '',
    warning: String(overrides.value.colors?.warning || '').startsWith('#')
        ? String(overrides.value.colors?.warning)
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

const commitFontSize = debounce(
    (v: number) => set({ typography: { baseFontPx: v } }),
    70
);
const commitOpacity = debounce(
    (
        key: 'contentBg1Opacity' | 'contentBg2Opacity' | 'sidebarBgOpacity',
        v: number
    ) => {
        if (key === 'contentBg1Opacity') {
            set({ backgrounds: { content: { base: { opacity: v } } } });
        } else if (key === 'contentBg2Opacity') {
            set({ backgrounds: { content: { overlay: { opacity: v } } } });
        } else if (key === 'sidebarBgOpacity') {
            set({ backgrounds: { sidebar: { opacity: v } } });
        }
    },
    70
);

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
    // Map old keys to new structure
    if (key === 'contentBg1Repeat') {
        const current =
            overrides.value.backgrounds?.content?.base?.repeat || 'no-repeat';
        const next = current === 'repeat' ? 'no-repeat' : 'repeat';
        set({ backgrounds: { content: { base: { repeat: next } } } });
    } else if (key === 'contentBg2Repeat') {
        const current =
            overrides.value.backgrounds?.content?.overlay?.repeat ||
            'no-repeat';
        const next = current === 'repeat' ? 'no-repeat' : 'repeat';
        set({ backgrounds: { content: { overlay: { repeat: next } } } });
    } else if (key === 'sidebarRepeat') {
        const current =
            overrides.value.backgrounds?.sidebar?.repeat || 'no-repeat';
        const next = current === 'repeat' ? 'no-repeat' : 'repeat';
        set({ backgrounds: { sidebar: { repeat: next } } });
    }
}

const commitSize = debounce(
    (
        key: 'contentBg1SizePx' | 'contentBg2SizePx' | 'sidebarBgSizePx',
        v: number
    ) => {
        if (key === 'contentBg1SizePx') {
            set({ backgrounds: { content: { base: { sizePx: v } } } });
        } else if (key === 'contentBg2SizePx') {
            set({ backgrounds: { content: { overlay: { sizePx: v } } } });
        } else if (key === 'sidebarBgSizePx') {
            set({ backgrounds: { sidebar: { sizePx: v } } });
        }
    },
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
        set({ backgrounds: { content: { base: { url: null, opacity: 0 } } } });
    } else if (which === 'contentBg2') {
        set({
            backgrounds: { content: { overlay: { url: null, opacity: 0 } } },
        });
    } else if (which === 'sidebarBg') {
        set({ backgrounds: { sidebar: { url: null, opacity: 0 } } });
    }
}

function toggleReduceHighContrast() {
    const current = overrides.value.ui?.reducePatternsInHighContrast ?? false;
    set({
        ui: { reducePatternsInHighContrast: !current },
    });
    reapply();
}

const presetsContent1 = [
    { label: 'Default', src: '/bg-repeat.v2.webp', opacity: 0.08 },
];
const presetsContent2 = [
    { label: 'Default', src: '/bg-repeat-2.v2.webp', opacity: 0.125 },
];
const presetsSidebar = [
    { label: 'Default', src: '/sidebar-repeater.v2.webp', opacity: 0.1 },
];

function applyPreset(
    which: 'contentBg1' | 'contentBg2' | 'sidebarBg',
    src: string,
    opacity: number
) {
    if (which === 'contentBg1')
        set({ backgrounds: { content: { base: { url: src, opacity } } } });
    else if (which === 'contentBg2')
        set({ backgrounds: { content: { overlay: { url: src, opacity } } } });
    else if (which === 'sidebarBg')
        set({ backgrounds: { sidebar: { url: src, opacity } } });
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
    // Try overrides first; if absent, fall back to base theme CSS variables
    const o1 = overrides.value.backgrounds?.content?.base?.url || null;
    const r1 = await resolveInternalPath(o1);
    resolvedContentBg1.value = r1 || getCssVarUrl('--app-content-bg-1');

    const o2 = overrides.value.backgrounds?.content?.overlay?.url || null;
    const r2 = await resolveInternalPath(o2);
    resolvedContentBg2.value = r2 || getCssVarUrl('--app-content-bg-2');

    const os = overrides.value.backgrounds?.sidebar?.url || null;
    const rs = await resolveInternalPath(os);
    resolvedSidebarBg.value = rs || getCssVarUrl('--app-sidebar-bg-1');
}

watch(
    () => [
        overrides.value.backgrounds?.content?.base?.url,
        overrides.value.backgrounds?.content?.overlay?.url,
        overrides.value.backgrounds?.sidebar?.url,
    ],
    () => {
        refreshResolved();
    },
    { immediate: true }
);

const contentBg1PreviewStyle = computed(() => {
    const fit = !!overrides.value.backgrounds?.content?.base?.fit;
    const repeatEnabled =
        overrides.value.backgrounds?.content?.base?.repeat === 'repeat' && !fit;
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
    const fit = !!overrides.value.backgrounds?.content?.overlay?.fit;
    const repeatEnabled =
        overrides.value.backgrounds?.content?.overlay?.repeat === 'repeat' &&
        !fit;
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
    const fit = !!overrides.value.backgrounds?.sidebar?.fit;
    const repeatEnabled =
        overrides.value.backgrounds?.sidebar?.repeat === 'repeat' && !fit;
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
    let currentUrl = '';
    if (which === 'contentBg1') {
        currentUrl = overrides.value.backgrounds?.content?.base?.url || '';
    } else if (which === 'contentBg2') {
        currentUrl = overrides.value.backgrounds?.content?.overlay?.url || '';
    } else if (which === 'sidebarBg') {
        currentUrl = overrides.value.backgrounds?.sidebar?.url || '';
    }
    return currentUrl === src ? 'active' : '';
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
        if (which === 'contentBg1')
            set({ backgrounds: { content: { base: { url: token } } } });
        else if (which === 'contentBg2')
            set({ backgrounds: { content: { overlay: { url: token } } } });
        else if (which === 'sidebarBg')
            set({ backgrounds: { sidebar: { url: token } } });
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

function togglePaletteOverrides() {
    const currentlyEnabled = overrides.value.colors?.enabled ?? false;

    if (!currentlyEnabled) {
        // Enabling: Initialize with current theme colors
        const colorMap: Array<[string, string]> = [
            ['primary', '--md-primary'],
            ['onPrimary', '--md-on-primary'],
            ['primaryContainer', '--md-primary-container'],
            ['onPrimaryContainer', '--md-on-primary-container'],
            ['secondary', '--md-secondary'],
            ['onSecondary', '--md-on-secondary'],
            ['secondaryContainer', '--md-secondary-container'],
            ['onSecondaryContainer', '--md-on-secondary-container'],
            ['tertiary', '--md-tertiary'],
            ['onTertiary', '--md-on-tertiary'],
            ['tertiaryContainer', '--md-tertiary-container'],
            ['onTertiaryContainer', '--md-on-tertiary-container'],
            ['error', '--md-error'],
            ['onError', '--md-on-error'],
            ['errorContainer', '--md-error-container'],
            ['onErrorContainer', '--md-on-error-container'],
            ['surface', '--md-surface'],
            ['onSurface', '--md-on-surface'],
            ['surfaceVariant', '--md-surface-variant'],
            ['onSurfaceVariant', '--md-on-surface-variant'],
            ['inverseSurface', '--md-inverse-surface'],
            ['inverseOnSurface', '--md-inverse-on-surface'],
            ['outline', '--md-outline'],
            ['outlineVariant', '--md-outline-variant'],
            ['success', '--md-extended-color-success-color'],
            ['warning', '--md-extended-color-warning-color'],
        ];

        const initialColors: any = { enabled: true };
        for (const [key, cssVar] of colorMap) {
            const color = getCurrentThemeColor(cssVar);
            if (color) {
                initialColors[key] = color;
            }
        }

        set({ colors: initialColors });
    } else {
        // Disabling: Just toggle off
        set({ colors: { enabled: false } });
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
        // Map background color keys
        if (key === 'contentBg1Color') {
            set({
                backgrounds: {
                    content: { base: { color: candidate.toLowerCase() } },
                },
            });
        } else if (key === 'contentBg2Color') {
            set({
                backgrounds: {
                    content: { overlay: { color: candidate.toLowerCase() } },
                },
            });
        } else if (key === 'sidebarBgColor') {
            set({
                backgrounds: { sidebar: { color: candidate.toLowerCase() } },
            });
        } else {
            // All other keys are palette colors - map directly
            set({ colors: { [key]: candidate.toLowerCase() } } as any);
        }
    }
}
async function copyColor(key: keyof typeof localHex) {
    let val = '';
    // Map to override paths
    if (key === 'contentBg1Color') {
        val = String(overrides.value.backgrounds?.content?.base?.color || '');
    } else if (key === 'contentBg2Color') {
        val = String(
            overrides.value.backgrounds?.content?.overlay?.color || ''
        );
    } else if (key === 'sidebarBgColor') {
        val = String(overrides.value.backgrounds?.sidebar?.color || '');
    } else {
        // All other keys are palette colors
        val = (overrides.value.colors as any)?.[key] || '';
    }

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
    overrides,
    (o) => {
        if (!o) return;
        local.baseFontPx = o.typography?.baseFontPx || 20;
        local.contentBg1Opacity = o.backgrounds?.content?.base?.opacity || 0;
        local.contentBg2Opacity = o.backgrounds?.content?.overlay?.opacity || 0;
        local.sidebarBgOpacity = o.backgrounds?.sidebar?.opacity || 0;
        local.contentBg1SizePx = o.backgrounds?.content?.base?.sizePx || 240;
        local.contentBg2SizePx = o.backgrounds?.content?.overlay?.sizePx || 240;
        local.sidebarBgSizePx = o.backgrounds?.sidebar?.sizePx || 240;
        // sync hex boxes (only show hex values) - backgrounds
        localHex.contentBg1Color = String(
            o.backgrounds?.content?.base?.color || ''
        ).startsWith('#')
            ? String(o.backgrounds?.content?.base?.color)
            : '';
        localHex.contentBg2Color = String(
            o.backgrounds?.content?.overlay?.color || ''
        ).startsWith('#')
            ? String(o.backgrounds?.content?.overlay?.color)
            : '';
        localHex.sidebarBgColor = String(
            o.backgrounds?.sidebar?.color || ''
        ).startsWith('#')
            ? String(o.backgrounds?.sidebar?.color)
            : '';
        // sync all palette hex boxes
        localHex.primary = String(o.colors?.primary || '').startsWith('#')
            ? String(o.colors?.primary)
            : '';
        localHex.onPrimary = String(o.colors?.onPrimary || '').startsWith('#')
            ? String(o.colors?.onPrimary)
            : '';
        localHex.primaryContainer = String(
            o.colors?.primaryContainer || ''
        ).startsWith('#')
            ? String(o.colors?.primaryContainer)
            : '';
        localHex.onPrimaryContainer = String(
            o.colors?.onPrimaryContainer || ''
        ).startsWith('#')
            ? String(o.colors?.onPrimaryContainer)
            : '';
        localHex.secondary = String(o.colors?.secondary || '').startsWith('#')
            ? String(o.colors?.secondary)
            : '';
        localHex.onSecondary = String(o.colors?.onSecondary || '').startsWith(
            '#'
        )
            ? String(o.colors?.onSecondary)
            : '';
        localHex.secondaryContainer = String(
            o.colors?.secondaryContainer || ''
        ).startsWith('#')
            ? String(o.colors?.secondaryContainer)
            : '';
        localHex.onSecondaryContainer = String(
            o.colors?.onSecondaryContainer || ''
        ).startsWith('#')
            ? String(o.colors?.onSecondaryContainer)
            : '';
        localHex.tertiary = String(o.colors?.tertiary || '').startsWith('#')
            ? String(o.colors?.tertiary)
            : '';
        localHex.onTertiary = String(o.colors?.onTertiary || '').startsWith('#')
            ? String(o.colors?.onTertiary)
            : '';
        localHex.tertiaryContainer = String(
            o.colors?.tertiaryContainer || ''
        ).startsWith('#')
            ? String(o.colors?.tertiaryContainer)
            : '';
        localHex.onTertiaryContainer = String(
            o.colors?.onTertiaryContainer || ''
        ).startsWith('#')
            ? String(o.colors?.onTertiaryContainer)
            : '';
        localHex.error = String(o.colors?.error || '').startsWith('#')
            ? String(o.colors?.error)
            : '';
        localHex.onError = String(o.colors?.onError || '').startsWith('#')
            ? String(o.colors?.onError)
            : '';
        localHex.errorContainer = String(
            o.colors?.errorContainer || ''
        ).startsWith('#')
            ? String(o.colors?.errorContainer)
            : '';
        localHex.onErrorContainer = String(
            o.colors?.onErrorContainer || ''
        ).startsWith('#')
            ? String(o.colors?.onErrorContainer)
            : '';
        localHex.surface = String(o.colors?.surface || '').startsWith('#')
            ? String(o.colors?.surface)
            : '';
        localHex.onSurface = String(o.colors?.onSurface || '').startsWith('#')
            ? String(o.colors?.onSurface)
            : '';
        localHex.surfaceVariant = String(
            o.colors?.surfaceVariant || ''
        ).startsWith('#')
            ? String(o.colors?.surfaceVariant)
            : '';
        localHex.onSurfaceVariant = String(
            o.colors?.onSurfaceVariant || ''
        ).startsWith('#')
            ? String(o.colors?.onSurfaceVariant)
            : '';
        localHex.inverseSurface = String(
            o.colors?.inverseSurface || ''
        ).startsWith('#')
            ? String(o.colors?.inverseSurface)
            : '';
        localHex.inverseOnSurface = String(
            o.colors?.inverseOnSurface || ''
        ).startsWith('#')
            ? String(o.colors?.inverseOnSurface)
            : '';
        localHex.outline = String(o.colors?.outline || '').startsWith('#')
            ? String(o.colors?.outline)
            : '';
        localHex.outlineVariant = String(
            o.colors?.outlineVariant || ''
        ).startsWith('#')
            ? String(o.colors?.outlineVariant)
            : '';
        localHex.success = String(o.colors?.success || '').startsWith('#')
            ? String(o.colors?.success)
            : '';
        localHex.warning = String(o.colors?.warning || '').startsWith('#')
            ? String(o.colors?.warning)
            : '';
    },
    { deep: true }
);
</script>

<style scoped>
/* Component-specific layout and typography (non-decorative) */
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
.fallback-row .theme-input {
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
    .fallback-row .theme-input {
        width: 100px;
    }
}
</style>
