/**
 * ManualOverrideExample Component Tests
 * ====================================
 * Tests for the manual theme override example component.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

// Mock the theme composables
vi.mock('~/composables/useThemeOverrides', () => ({
  useThemeOverrides: vi.fn()
}))

import ManualOverrideExample from '../ManualOverrideExample.vue'
import { useThemeOverrides } from '~/composables/useThemeOverrides'

const mockUseThemeOverrides = vi.mocked(useThemeOverrides)

describe('ManualOverrideExample', () => {
  beforeEach(() => {
    mockUseThemeOverrides.mockClear()
  })

  describe('Context-Specific Override', () => {
    it('should apply chat context overrides', () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({ variant: 'neon', size: 'sm' })
      })

      const wrapper = mount(ManualOverrideExample)
      
      // Check that useThemeOverrides was called 4 times
      expect(mockUseThemeOverrides).toHaveBeenCalledTimes(4)
      
      // Check for the chat context call (first call)
      expect(mockUseThemeOverrides).toHaveBeenNthCalledWith(
        1,
        'button',
        'chat',
        { variant: 'outline', size: 'sm' },
        expect.any(Object) // Ref object
      )
      
      // Find the first button (chat action button)
      const allButtons = wrapper.findAll('button')
      expect(allButtons).toHaveLength(4)
      
      const chatButton = allButtons[0]
      expect(chatButton).toBeDefined()
      expect(chatButton!.exists()).toBe(true)
      expect(chatButton!.text()).toBe('Chat Action (Manual)')
    })

    it('should handle context changes reactively', async () => {
      const overridesRef = ref({ variant: 'outline' })
      mockUseThemeOverrides.mockReturnValue({
        overrides: overridesRef
      })

      const wrapper = mount(ManualOverrideExample)
      
      // Initial state
      const allButtons = wrapper.findAll('button')
      const chatButton = allButtons[0]
      expect(chatButton).toBeDefined()
      expect(chatButton!.classes()).toContain('outline')
      
      // Change overrides
      overridesRef.value = { variant: 'solid' }
      await wrapper.vm.$nextTick()
      
      expect(chatButton!.classes()).toContain('solid')
    })
  })

  describe('Identifier-Specific Override', () => {
    it('should apply identifier-based overrides', () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({ variant: 'glowing', color: 'accent' })
      })

      const wrapper = mount(ManualOverrideExample)
      
      // Check for the identifier call (2nd call)
      expect(mockUseThemeOverrides).toHaveBeenNthCalledWith(
        2,
        'button',
        'global',
        { variant: 'solid', color: 'primary' },
        expect.any(Object) // Ref object
      )
      
      const allButtons = wrapper.findAll('button')
      const specialButton = allButtons[1]
      expect(specialButton).toBeDefined()
      expect(specialButton!.text()).toBe('Special Action (Manual)')
    })
  })

  describe('Props Merging', () => {
    it('should demonstrate props merging with theme overrides', () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({ variant: 'neon', size: 'xl' })
      })

      const wrapper = mount(ManualOverrideExample)
      
      // Check for the props merging call (3rd call)
      expect(mockUseThemeOverrides).toHaveBeenNthCalledWith(
        3,
        'button',
        'dashboard',
        { variant: 'outline', size: 'lg', color: 'secondary' },
        expect.any(Object) // Ref object
      )
      
      const allButtons = wrapper.findAll('button')
      const mergedButton = allButtons[2]
      expect(mergedButton).toBeDefined()
      expect(mergedButton!.text()).toBe('Merged Style Button')
    })
  })

  describe('State-based Overrides', () => {
    it('should apply state-based overrides', () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({ variant: 'ghost' })
      })

      const wrapper = mount(ManualOverrideExample)
      
      // Check for the state-based call (4th call)
      expect(mockUseThemeOverrides).toHaveBeenNthCalledWith(
        4,
        'button',
        'sidebar',
        { variant: 'ghost' },
        expect.any(Object) // Ref object
      )
      
      const allButtons = wrapper.findAll('button')
      const stateButton = allButtons[3]
      expect(stateButton).toBeDefined()
      expect(stateButton!.text()).toBe('Enabled Button')
    })

    it('should toggle state and update classes', async () => {
      const overridesRef = ref({ variant: 'ghost' })
      mockUseThemeOverrides.mockReturnValue({
        overrides: overridesRef
      })

      const wrapper = mount(ManualOverrideExample)
      const allButtons = wrapper.findAll('button')
      const stateButton = allButtons[3]
      expect(stateButton).toBeDefined()
      
      // Initial state
      expect(stateButton!.text()).toBe('Enabled Button')
      expect(stateButton!.attributes('disabled')).toBeUndefined()
      
      // Click to toggle state
      await stateButton!.trigger('click')
      
      expect(stateButton!.text()).toBe('Disabled Button')
      expect(stateButton!.attributes('disabled')).toBeDefined()
    })
  })

  describe('Event Handling', () => {
    it('should handle chat action click', async () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({})
      })

      const wrapper = mount(ManualOverrideExample)
      const allButtons = wrapper.findAll('button')
      const chatButton = allButtons[0]
      expect(chatButton).toBeDefined()
      
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      
      await chatButton!.trigger('click')
      
      expect(consoleSpy).toHaveBeenCalledWith('Chat action triggered with manual theme override')
      
      consoleSpy.mockRestore()
    })

    it('should handle special action click', async () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({})
      })

      const wrapper = mount(ManualOverrideExample)
      const allButtons = wrapper.findAll('button')
      const specialButton = allButtons[1]
      expect(specialButton).toBeDefined()
      
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      
      await specialButton!.trigger('click')
      
      expect(consoleSpy).toHaveBeenCalledWith('Special action triggered with identifier-based override')
      
      consoleSpy.mockRestore()
    })
  })

  describe('Accessibility', () => {
    it('should have proper button semantics', () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({})
      })

      const wrapper = mount(ManualOverrideExample)
      const buttons = wrapper.findAll('button')
      
      expect(buttons).toHaveLength(4)
      buttons.forEach(button => {
        expect(button.element.tagName).toBe('BUTTON')
      })
    })

    it('should handle disabled state correctly', async () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({})
      })

      const wrapper = mount(ManualOverrideExample)
      const allButtons = wrapper.findAll('button')
      const stateButton = allButtons[3]
      expect(stateButton).toBeDefined()
      
      // Enable state
      expect(stateButton!.text()).toBe('Enabled Button')
      expect(stateButton!.attributes('disabled')).toBeUndefined()
      
      // Click to disable
      await stateButton!.trigger('click')
      
      expect(stateButton!.text()).toBe('Disabled Button')
      expect(stateButton!.attributes('disabled')).toBeDefined()
    })
  })

  describe('Documentation Examples', () => {
    it('should render all example sections', () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({})
      })

      const wrapper = mount(ManualOverrideExample)
      
      const sections = wrapper.findAll('section')
      expect(sections).toHaveLength(4)
      
      const headings = wrapper.findAll('h4')
      expect(headings).toHaveLength(4)
      expect(headings[0]).toBeDefined()
      expect(headings[1]).toBeDefined()
      expect(headings[2]).toBeDefined()
      expect(headings[3]).toBeDefined()
      expect(headings[0]!.text()).toBe('Context-Specific Override (Chat)')
      expect(headings[1]!.text()).toBe('Identifier-Specific Override')
      expect(headings[2]!.text()).toBe('Props Merging Example')
      expect(headings[3]!.text()).toBe('State-based Override')
    })

    it('should display descriptive text for each example', () => {
      mockUseThemeOverrides.mockReturnValue({
        overrides: ref({})
      })

      const wrapper = mount(ManualOverrideExample)
      
      const descriptions = wrapper.findAll('p')
      expect(descriptions).toHaveLength(4)
      expect(descriptions[0]).toBeDefined()
      expect(descriptions[1]).toBeDefined()
      expect(descriptions[2]).toBeDefined()
      expect(descriptions[3]).toBeDefined()
      expect(descriptions[0]!.text()).toContain('useThemeOverrides with explicit \'chat\' context')
      expect(descriptions[1]!.text()).toContain('identifier for precise targeting')
      expect(descriptions[2]!.text()).toContain('manual props merge with theme overrides')
      expect(descriptions[3]!.text()).toContain('state-based theme overrides')
    })
  })
})
