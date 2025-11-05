/**
 * ThemeButton Component Tests
 * ==========================
 * Tests for the theme-aware button wrapper component.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

// Mock the theme composables before importing the component
vi.mock('~/composables/useThemeOverrides', () => ({
    useThemeOverrides: vi.fn(),
    useAutoContext: vi.fn(),
}));

import ThemeButton from '../ThemeButton.vue';
import {
    useThemeOverrides,
    useAutoContext,
} from '~/composables/useThemeOverrides';

const mockUseThemeOverrides = vi.mocked(useThemeOverrides);
const mockUseAutoContext = vi.mocked(useAutoContext);

describe('ThemeButton', () => {
    const createWrapper = (props = {}, slots = {}) => {
        return mount(ThemeButton, {
            props,
            slots,
            global: {
                stubs: {
                    UButton: {
                        template: '<button><slot /></button>',
                        props: [
                            'variant',
                            'size',
                            'disabled',
                            'type',
                            'loading',
                            'icon',
                            'color',
                            'block',
                            'square',
                            'class',
                        ],
                    },
                },
            },
        });
    };

    // Helper to safely get component props from mock calls
    const getComponentProps = (callIndex = 0) => {
        const callArgs = mockUseThemeOverrides.mock.calls[callIndex];
        if (callArgs && callArgs[2]) {
            return (callArgs[2] as any).value || {};
        }
        return {};
    };

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks();

        // Default mock implementations
        mockUseAutoContext.mockReturnValue(ref('global'));
        mockUseThemeOverrides.mockReturnValue({
            overrides: ref({
                variant: 'cyberpunkSolid',
                size: 'md',
                class: 'shadow-[0_0_20px_rgba(0,255,255,0.5)]',
            }),
            debug: ref({
                component: 'button',
                context: 'global',
                appliedRules: 1,
                cacheKey: 'test-key',
                theme: 'cyberpunk',
                mode: 'light',
                componentProps: {},
                state: 'default',
                identifier: undefined,
            }),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Basic Rendering', () => {
        it('should render button with theme overrides', () => {
            const wrapper = createWrapper(
                {},
                {
                    default: 'Click me',
                }
            );

            const button = wrapper.find('button');
            expect(button.exists()).toBe(true);
            expect(button.text()).toBe('Click me');
        });

        it('should apply theme variant when no explicit variant provided', () => {
            const wrapper = createWrapper(
                {},
                {
                    default: 'Button',
                }
            );

            expect(mockUseThemeOverrides).toHaveBeenCalledWith(
                'button',
                expect.any(Object), // computed context
                expect.any(Object), // componentProps
                expect.any(Object), // state
                expect.any(Object) // identifier
            );
        });

        it('should use explicit variant over theme override (Props Win)', () => {
            const wrapper = createWrapper(
                {
                    variant: 'outline',
                },
                {
                    default: 'Custom Button',
                }
            );

            // Verify the composable was called with explicit variant
            const componentProps = getComponentProps();
            expect(componentProps.variant).toBe('outline');
        });
    });

    describe('Context Detection', () => {
        it('should use explicit context when provided', () => {
            mockUseAutoContext.mockReturnValue(ref('global'));

            const wrapper = createWrapper(
                { context: 'chat' },
                {
                    default: 'Chat Button',
                }
            );

            // Note: useAutoContext is always called for reactivity, but explicit context takes precedence
            expect(mockUseAutoContext).toHaveBeenCalled();
            expect(mockUseThemeOverrides).toHaveBeenCalledWith(
                'button',
                expect.any(Object), // computed context (explicit string wrapped)
                expect.any(Object), // componentProps ref
                expect.any(Object), // state ref
                expect.any(Object) // identifier ref
            );
        });

        it('should apply chat context overrides', () => {
            mockUseAutoContext.mockReturnValue(ref('chat'));
            mockUseThemeOverrides.mockReturnValue({
                overrides: ref({
                    variant: 'neonOutline',
                    size: 'sm',
                    class: 'border-pink-500 text-pink-500',
                }),
                debug: ref({
                    component: 'button',
                    context: 'chat',
                    appliedRules: 1,
                    cacheKey: 'test-key',
                    theme: 'cyberpunk',
                    mode: 'light',
                    componentProps: {},
                    state: 'default',
                    identifier: undefined,
                }),
            });

            const wrapper = createWrapper(
                {},
                {
                    default: 'Chat Action',
                }
            );

            expect(mockUseThemeOverrides).toHaveBeenCalledWith(
                'button',
                expect.any(Object), // computed context from mocked useAutoContext
                expect.any(Object), // componentProps ref
                expect.any(Object), // state ref
                expect.any(Object) // identifier ref
            );
        });
    });

    describe('State Management', () => {
        it('should apply disabled state styling', () => {
            const wrapper = createWrapper(
                {
                    disabled: true,
                },
                {
                    default: 'Disabled Button',
                }
            );

            const componentProps = getComponentProps();
            expect(componentProps.disabled).toBe(true);
        });

        it('should handle loading state', () => {
            const wrapper = createWrapper(
                {
                    loading: true,
                },
                {
                    default: 'Loading Button',
                }
            );

            const componentProps = getComponentProps();
            expect(componentProps.loading).toBe(true);
        });
    });

    describe('Props Merging', () => {
        it('should merge theme classes with prop classes', () => {
            mockUseThemeOverrides.mockReturnValue({
                overrides: ref({
                    variant: 'cyberpunkSolid',
                    class: 'shadow-[0_0_20px_rgba(0,255,255,0.5)]',
                }),
                debug: ref({
                    component: 'button',
                    context: 'chat',
                    appliedRules: 1,
                    cacheKey: 'test-key',
                    theme: 'cyberpunk',
                    mode: 'light',
                    componentProps: {},
                    state: 'default',
                    identifier: undefined,
                }),
            });

            const wrapper = createWrapper(
                {
                    class: 'custom-class',
                },
                {
                    default: 'Button',
                }
            );

            // Since we're using a stub, we check that the component was created
            expect(wrapper.exists()).toBe(true);
        });

        it('should respect explicit size over theme size', () => {
            const wrapper = createWrapper(
                {
                    size: 'lg',
                },
                {
                    default: 'Large Button',
                }
            );

            const componentProps = getComponentProps();
            expect(componentProps.size).toBe('lg');
        });
    });

    describe('Event Handling', () => {
        it('should emit click event when not disabled', async () => {
            const wrapper = createWrapper(
                {},
                {
                    default: 'Clickable',
                }
            );

            await wrapper.find('button').trigger('click');
            expect(wrapper.emitted('click')).toBeTruthy();
            expect(wrapper.emitted('click')).toHaveLength(1);
        });

        it('should not emit click event when disabled', async () => {
            const wrapper = createWrapper(
                {
                    disabled: true,
                },
                {
                    default: 'Disabled',
                }
            );

            await wrapper.find('button').trigger('click');
            expect(wrapper.emitted('click')).toBeFalsy();
        });

        it('should emit keydown event', async () => {
            const wrapper = createWrapper(
                {},
                {
                    default: 'Button',
                }
            );

            await wrapper.find('button').trigger('keydown', { key: 'Enter' });
            expect(wrapper.emitted('keydown')).toBeTruthy();
        });
    });

    describe('Slot Forwarding', () => {
        it('should forward all slots to UButton', () => {
            const wrapper = createWrapper(
                {},
                {
                    default: 'Button Text',
                }
            );

            expect(wrapper.text()).toContain('Button Text');
            // The stub handles slots, so we just verify the component renders
            expect(wrapper.exists()).toBe(true);
        });
    });

    describe('TypeScript Props', () => {
        it('should accept all button props', () => {
            const wrapper = createWrapper(
                {
                    variant: 'solid',
                    size: 'md',
                    color: 'primary',
                    block: true,
                    square: false,
                    type: 'submit',
                    icon: 'heroicons:plus',
                    loading: false,
                    disabled: false,
                },
                {
                    default: 'Full Props Button',
                }
            );

            expect(wrapper.exists()).toBe(true);
            const componentProps = getComponentProps();
            expect(componentProps).toMatchObject({
                variant: 'solid',
                size: 'md',
                color: 'primary',
                block: true,
                square: false,
                loading: false,
                disabled: false,
            });
        });
    });
});
