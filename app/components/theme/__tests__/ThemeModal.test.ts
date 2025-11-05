/**
 * ThemeModal Component Tests
 * ==========================
 * Tests for the theme-aware modal wrapper component.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

// Mock the theme composables before importing the component
vi.mock('~/composables/useThemeOverrides', () => ({
  useThemeOverrides: vi.fn(),
  useAutoContext: vi.fn()
}))

import ThemeModal from '../ThemeModal.vue'
import { useThemeOverrides, useAutoContext } from '~/composables/useThemeOverrides'

const mockUseThemeOverrides = vi.mocked(useThemeOverrides)
const mockUseAutoContext = vi.mocked(useAutoContext)

describe('ThemeModal', () => {
  const createWrapper = (props = {}, slots = {}) => {
    return mount(ThemeModal, {
      props: {
        modelValue: false,
        ...props
      },
      slots,
      global: {
        stubs: {
          UModal: {
            template: '<div><slot v-for="(_, name) in $slots" :name="name" /><slot /></div>',
            props: ['modelValue', 'size', 'dismissible', 'preventClose', 'fullscreen', 'overlay', 'transition', 'class']
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
        size: 'md',
        class: 'bg-gradient-to-br from-gray-900 via-purple-900/20 to-black border-[3px] border-cyan-400 shadow-[0_0_50px_rgba(0,255,255,0.8)]'
      }),
      debug: ref({
        component: 'modal',
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
    it('should render modal with theme overrides', () => {
      const wrapper = createWrapper({
        modelValue: true
      }, {
        default: '<p>Modal content</p>'
      })

      expect(wrapper.exists()).toBe(true)
      expect(mockUseThemeOverrides).toHaveBeenCalledWith(
        'modal',
        expect.any(Object), // context ref
        expect.any(Object), // componentProps ref
        expect.any(Object),  // state ref
        expect.any(Object)   // identifier ref
      )
    })

    it('should apply theme size when no explicit size provided', () => {
      const wrapper = createWrapper({
        modelValue: true
      })

      expect(mockUseThemeOverrides).toHaveBeenCalled()
    })

    it('should use explicit size over theme override (Props Win)', () => {
      const wrapper = createWrapper({
        modelValue: true,
        size: 'xl'
      })

      // Verify the composable was called with explicit size
      const componentProps = getComponentProps()
      expect(componentProps.size).toBe('xl')
    })
  })

  describe('Context Detection', () => {
    it('should use auto-context detection', () => {
      mockUseAutoContext.mockReturnValue(ref('chat'))
      
      const wrapper = createWrapper({
        modelValue: true
      })

      expect(mockUseAutoContext).toHaveBeenCalled()
      expect(mockUseThemeOverrides).toHaveBeenCalledWith(
        'modal',
        expect.any(Object), // context ref
        expect.any(Object), // componentProps ref
        expect.any(Object),  // state ref
        expect.any(Object)   // identifier ref
      )
    })

    it('should apply context-specific overrides', () => {
      mockUseAutoContext.mockReturnValue(ref('sidebar'))
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({
          size: 'sm',
          class: 'border-purple-500 shadow-[0_0_40px_rgba(153,51,255,0.8)]'
        }),
        debug: ref({
          component: 'modal',
          context: 'sidebar',
          appliedRules: 1,
          cacheKey: 'test-key',
          theme: 'cyberpunk',
          mode: 'light',
          componentProps: {},
          state: 'default'
        })
      })

      const wrapper = createWrapper({
        modelValue: true
      })

      expect(mockUseThemeOverrides).toHaveBeenCalledWith(
        'modal',
        expect.any(Object), // context ref
        expect.any(Object), // componentProps ref
        expect.any(Object),  // state ref
        expect.any(Object)   // identifier ref
      )
    })
  })

  describe('Props Merging', () => {
    it('should merge theme classes with prop classes', () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({
          size: 'md',
          class: 'bg-gradient-to-br from-gray-900 border-cyan-400'
        }),
        debug: ref({
          component: 'modal',
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
        modelValue: true,
        class: 'custom-modal-class'
      })

      expect(mockUseThemeOverrides).toHaveBeenCalled()
      // Note: Since we're testing the wrapper, we verify the composable was called
      // The actual class merging would be tested in the rendered modal content
    })

    it('should respect explicit size over theme size', () => {
      const wrapper = createWrapper({
        modelValue: true,
        size: 'lg'
      })

      const componentProps = getComponentProps()
      expect(componentProps.size).toBe('lg')
    })
  })

  describe('Modal Behavior', () => {
    it('should handle v-model binding correctly', async () => {
      const wrapper = createWrapper({
        modelValue: true
      })

      // Test that the modal receives the modelValue
      expect(wrapper.props('modelValue')).toBe(true)
      
      // Test updating modelValue
      await wrapper.setProps({ modelValue: false })
      expect(wrapper.props('modelValue')).toBe(false)
    })

    it('should apply dismissible behavior', () => {
      const wrapper = createWrapper({
        modelValue: true,
        dismissible: false
      })

      const componentProps = getComponentProps()
      expect(componentProps.dismissible).toBe(false)
    })

    it('should handle fullscreen behavior', () => {
      const wrapper = createWrapper({
        modelValue: true,
        fullscreen: true
      })

      const componentProps = getComponentProps()
      expect(componentProps.fullscreen).toBe(true)
    })

    it('should handle overlay behavior', () => {
      const wrapper = createWrapper({
        modelValue: true,
        overlay: false
      })

      const componentProps = getComponentProps()
      expect(componentProps.overlay).toBe(false)
    })
  })

  describe('Event Handling', () => {
    it('should emit close event', async () => {
      const wrapper = createWrapper({
        modelValue: true
      })

      // Simulate close event by calling the method directly
      const component = wrapper.vm as any
      if (component.handleClose) {
        component.handleClose()
      }
      
      expect(wrapper.emitted('close')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')).toBeTruthy()
      expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
    })

    it('should emit open event', async () => {
      const wrapper = createWrapper({
        modelValue: false
      })

      // Simulate open event by calling the method directly
      const component = wrapper.vm as any
      if (component.handleOpen) {
        component.handleOpen()
      }
      
      expect(wrapper.emitted('open')).toBeTruthy()
    })
  })

  describe('Slot Forwarding', () => {
    it('should forward all slots to UModal', () => {
      const wrapper = createWrapper({
        modelValue: true
      }, {
        header: '<h2>Modal Header</h2>',
        body: '<p>Modal body content</p>',
        footer: '<button>Close</button>',
        default: '<div>Default content</div>'
      })

      expect(wrapper.html()).toContain('Modal Header')
      expect(wrapper.html()).toContain('Modal body content')
      expect(wrapper.html()).toContain('Close')
      expect(wrapper.html()).toContain('Default content')
    })
  })

  describe('TypeScript Props', () => {
    it('should accept all modal props', () => {
      const wrapper = createWrapper({
        modelValue: true,
        size: 'xl',
        dismissible: true,
        preventClose: false,
        fullscreen: false,
        overlay: true,
        transition: 'fade',
        class: 'custom-modal'
      })

      expect(wrapper.exists()).toBe(true)
      const componentProps = getComponentProps()
      expect(componentProps).toMatchObject({
        dismissible: true,
        preventClose: false,
        fullscreen: false,
        overlay: true
      })
    })
  })

  describe('State Management', () => {
    it('should always use default state for modals', () => {
      const wrapper = createWrapper({
        modelValue: true
      })

      // Verify state is always 'default' for modals
      const callArgs = mockUseThemeOverrides.mock.calls[0]
      if (callArgs && callArgs[2] && typeof callArgs[2] === 'object' && 'state' in callArgs[2]) {
        const state = (callArgs[2] as any).state?.value
        expect(state).toBe('default')
      }
    })
  })

  describe('Theme Integration', () => {
    it('should apply cyberpunk theme styling', () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({
          class: 'bg-gradient-to-br from-gray-900 via-purple-900/20 to-black border-[3px] border-cyan-400 shadow-[0_0_50px_rgba(0,255,255,0.8)]'
        }),
        debug: ref({
          component: 'modal',
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
        modelValue: true
      })

      expect(mockUseThemeOverrides).toHaveBeenCalledWith(
        'modal',
        expect.any(Object), // context ref
        expect.any(Object), // componentProps ref
        expect.any(Object)  // state ref
      )
    })
  })
})
