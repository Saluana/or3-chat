/**
 * ThemeInput Component Tests
 * =========================
 * Tests for the theme-aware input wrapper component.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

// Mock the theme composables before importing the component
vi.mock('~/composables/useThemeOverrides', () => ({
  useThemeOverrides: vi.fn(),
  useAutoContext: vi.fn()
}))

import ThemeInput from '../ThemeInput.vue'
import { useThemeOverrides, useAutoContext } from '~/composables/useThemeOverrides'

const mockUseThemeOverrides = vi.mocked(useThemeOverrides)
const mockUseAutoContext = vi.mocked(useAutoContext)

describe('ThemeInput', () => {
  const createWrapper = (props = {}, slots = {}) => {
    return mount(ThemeInput, {
      props,
      slots,
      global: {
        stubs: {
          UInput: {
            template: '<input :value="modelValue" :placeholder="placeholder" :name="name" :id="id" :disabled="disabled" :readonly="readonly" :required="required" :type="type" :maxlength="maxlength" :minlength="minlength" :pattern="pattern" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event)" @change="$emit(\'change\', $event)" @focus="$emit(\'focus\', $event)" @blur="$emit(\'blur\', $event)" @keydown="$emit(\'keydown\', $event)"><slot /></input>',
            props: ['variant', 'size', 'disabled', 'type', 'placeholder', 'name', 'id', 'class', 'modelValue', 'readonly', 'required', 'maxlength', 'minlength', 'pattern', 'loading']
          }
        }
      }
    })
  }

  // Helper to safely get component props from mock calls
  const getComponentProps = (callIndex = 0) => {
    const callArgs = mockUseThemeOverrides.mock.calls[callIndex]
    if (callArgs && callArgs[2]) {
      return (callArgs[2] as any).value || {}
    }
    return {}
  }

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()
    
    // Default mock implementations
    mockUseAutoContext.mockReturnValue(ref('global'))
    mockUseThemeOverrides.mockReturnValue({
      overrides: ref({
        variant: 'cyberpunk',
        size: 'md',
        class: 'bg-black border-2 border-cyan-400 text-cyan-400'
      }),
      debug: ref({
        component: 'input',
        context: 'global',
        appliedRules: 1,
        cacheKey: 'test-key',
        theme: 'cyberpunk',
        mode: 'light',
        componentProps: {},
        state: 'default'
      })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Basic Rendering', () => {
    it('should render input with theme overrides', () => {
      const wrapper = createWrapper({
        modelValue: 'test value',
        placeholder: 'Enter text...'
      })

      const input = wrapper.find('input')
      expect(input.exists()).toBe(true)
      expect(input.element.value).toBe('test value')
      expect(input.attributes('placeholder')).toBe('Enter text...')
    })

    it('should apply theme variant when no explicit variant provided', () => {
      const wrapper = createWrapper({
        modelValue: ''
      })

      expect(mockUseThemeOverrides).toHaveBeenCalledWith(
        'input',
        expect.any(Object), // context ref
        expect.any(Object), // componentProps ref
        expect.any(Object)  // state ref
      )
    })

    it('should use explicit variant over theme override (Props Win)', () => {
      const wrapper = createWrapper({
        variant: 'terminal',
        modelValue: ''
      })

      // Verify the composable was called with explicit variant
      const componentProps = getComponentProps()
      expect(componentProps.variant).toBe('terminal')
    })
  })

  describe('Context Detection', () => {
    it('should use auto-context detection', () => {
      mockUseAutoContext.mockReturnValue(ref('chat'))
      
      const wrapper = createWrapper({
        modelValue: ''
      })

      expect(mockUseAutoContext).toHaveBeenCalled()
      expect(mockUseThemeOverrides).toHaveBeenCalledWith(
        'input',
        expect.any(Object), // context ref
        expect.any(Object), // componentProps ref
        expect.any(Object)  // state ref
      )
    })

    it('should apply chat context overrides', () => {
      mockUseAutoContext.mockReturnValue(ref('chat'))
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({
          variant: 'neon',
          size: 'sm',
          class: 'border-pink-500 text-pink-500'
        }),
        debug: ref({
          component: 'input',
          context: 'chat',
          appliedRules: 1,
          cacheKey: 'test-key',
          theme: 'cyberpunk',
          mode: 'light',
          componentProps: {},
          state: 'default'
        })
      })

      const wrapper = createWrapper({
        modelValue: ''
      })

      expect(mockUseThemeOverrides).toHaveBeenCalledWith(
        'input',
        expect.any(Object), // context ref
        expect.any(Object), // componentProps ref
        expect.any(Object)  // state ref
      )
    })
  })

  describe('State Management', () => {
    it('should apply disabled state styling', () => {
      const wrapper = createWrapper({
        disabled: true,
        modelValue: ''
      })

      const componentProps = getComponentProps()
      expect(componentProps.disabled).toBe(true)
    })

    it('should apply readonly state', () => {
      const wrapper = createWrapper({
        readonly: true,
        modelValue: 'readonly value'
      })

      const componentProps = getComponentProps()
      expect(componentProps.readonly).toBe(true)
    })

    it('should handle loading state', () => {
      const wrapper = createWrapper({
        loading: true,
        modelValue: ''
      })

      const componentProps = getComponentProps()
      expect(componentProps.loading).toBe(true)
    })
  })

  describe('Props Merging', () => {
    it('should merge theme classes with prop classes', () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({
          variant: 'cyberpunk',
          class: 'bg-black border-2 border-cyan-400'
        }),
        debug: ref({
          component: 'input',
          context: 'global',
          appliedRules: 1,
          cacheKey: 'test-key',
          theme: 'cyberpunk',
          mode: 'light',
          componentProps: {},
          state: 'default'
        })
      })

      const wrapper = createWrapper({
        class: 'custom-input-class',
        modelValue: ''
      })

      expect(wrapper.exists()).toBe(true)
    })

    it('should respect explicit size over theme size', () => {
      const wrapper = createWrapper({
        size: 'lg',
        modelValue: ''
      })

      const componentProps = getComponentProps()
      expect(componentProps.size).toBe('lg')
    })
  })

  describe('Event Handling', () => {
    it('should emit update:modelValue on input', async () => {
      const wrapper = createWrapper({
        modelValue: ''
      })

      const input = wrapper.find('input')
      await input.setValue('new value')
      
      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['new value'])
    })

    it('should emit input event', async () => {
      const wrapper = createWrapper({
        modelValue: ''
      })

      const input = wrapper.find('input')
      await input.setValue('test')
      
      expect(wrapper.emitted('input')).toBeTruthy()
    })

    it('should handle focus and blur events', async () => {
      const wrapper = createWrapper({
        modelValue: ''
      })

      const input = wrapper.find('input')
      await input.trigger('focus')
      expect(wrapper.emitted('focus')).toBeTruthy()

      await input.trigger('blur')
      expect(wrapper.emitted('blur')).toBeTruthy()
    })
  })

  describe('TypeScript Props', () => {
    it('should accept all input props', () => {
      const wrapper = createWrapper({
        variant: 'cyberpunk',
        size: 'md',
        disabled: false,
        readonly: false,
        type: 'text',
        required: false,
        loading: false,
        modelValue: 'test',
        placeholder: 'Test input',
        name: 'test',
        id: 'test-input'
      })

      expect(wrapper.exists()).toBe(true)
      const componentProps = getComponentProps()
      expect(componentProps).toMatchObject({
        variant: 'cyberpunk',
        size: 'md',
        disabled: false,
        readonly: false,
        type: 'text',
        required: false,
        loading: false
      })
    })
  })
})
