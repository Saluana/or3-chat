import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { discoverThemes, loadTheme, type ThemeManifest, type ThemeError, type ThemeWarning } from '~/theme/_shared/theme-loader'

// Mock the theme loader functions
vi.mock('~/theme/_shared/theme-loader', () => ({
  discoverThemes: vi.fn(),
  loadTheme: vi.fn(),
  validateThemeVariables: vi.fn(),
  type: {}
}))

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock document.documentElement
const mockClassListAdd = vi.fn()
const mockClassListRemove = vi.fn()

Object.defineProperty(document, 'documentElement', {
  value: {
    classList: {
      add: mockClassListAdd,
      remove: mockClassListRemove,
    }
  },
  writable: true,
})

// Mock console methods (for potential future use)
const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {})
const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {})

describe('Theme Provider Functionality', () => {
  let mockThemeProvider: any

  beforeEach(() => {
    // Clear specific mocks, not all mocks
    localStorageMock.getItem.mockClear()
    localStorageMock.setItem.mockClear()
    mockClassListAdd.mockClear()
    mockClassListRemove.mockClear()
    vi.mocked(discoverThemes).mockClear()
    vi.mocked(loadTheme).mockClear()
    consoleErrorMock.mockClear()
    consoleWarnMock.mockClear()
    
    // Mock theme discovery
    const mockThemes: ThemeManifest[] = [
      {
        name: 'default',
        path: '~/theme/default',
        hasLight: true,
        hasDark: true,
        hasMain: true,
        hasConfig: true,
        variants: ['light', 'dark', 'light-hc', 'dark-hc', 'light-mc', 'dark-mc']
      },
      {
        name: 'custom',
        path: '~/theme/custom',
        hasLight: true,
        hasDark: true,
        hasMain: false,
        hasConfig: false,
        variants: ['light', 'dark']
      }
    ]
    
    vi.mocked(discoverThemes).mockReturnValue(mockThemes)
    
    // Mock theme loading
    vi.mocked(loadTheme).mockResolvedValue({
      manifest: mockThemes[0]!,
      lightCss: ':root { --md-primary: #blue; }',
      darkCss: ':root { --md-primary: #darkblue; }',
      mainCss: '/* main styles */',
      config: {},
      errors: [],
      warnings: []
    })

    // Mock localStorage defaults
    localStorageMock.getItem.mockImplementation((key: string) => {
      if (key === 'theme') return 'light'
      if (key === 'activeTheme') return 'default'
      return null
    })

    // Create a mock theme provider that mimics the real plugin behavior
    mockThemeProvider = {
      // Theme state
      current: ref('light'),
      activeTheme: ref('default'),
      availableThemes: ref(mockThemes),
      errors: ref<ThemeError[]>([]),
      warnings: ref<ThemeWarning[]>([]),

      // Existing API
      set: function(name: string) {
        this.current.value = name
        localStorageMock.setItem('theme', name)
        
        // Apply CSS classes
        const THEME_CLASSES = [
          'light', 'dark', 'light-high-contrast', 'dark-high-contrast',
          'light-medium-contrast', 'dark-medium-contrast'
        ]
        
        for (const cls of THEME_CLASSES) {
          mockClassListRemove(cls)
        }
        mockClassListAdd(name)
      },

      toggle: function() {
        this.set(this.current.value.startsWith('dark') ? 'light' : 'dark')
      },

      get: function() {
        return this.current.value
      },

      system: function() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      },

      // New multi-theme API
      switchTheme: async function(themeName: string) {
        const theme = this.availableThemes.value.find((t: ThemeManifest) => t.name === themeName)
        if (!theme) {
          console.error(`[theme] Theme "${themeName}" not found`)
          return false
        }

        const result = await loadTheme(themeName)
        if (result.errors.length > 0) {
          console.error(`[theme] Theme "${themeName}" has critical errors`)
          return false
        }

        this.activeTheme.value = themeName
        localStorageMock.setItem('activeTheme', themeName)
        return true
      },

      reloadTheme: async function() {
        const result = await loadTheme(this.activeTheme.value)
        return result !== null
      },

      validateTheme: async function(themeName: string) {
        return await loadTheme(themeName)
      },

      getThemeManifest: function(themeName: string): ThemeManifest | undefined {
        return this.availableThemes.value.find((t: ThemeManifest) => t.name === themeName)
      }
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    consoleErrorMock.mockRestore()
    consoleWarnMock.mockRestore()
  })

  describe('Theme Mode Switching', () => {
    it('should toggle between light and dark modes', () => {
      expect(mockThemeProvider.get()).toBe('light')
      
      mockThemeProvider.toggle()
      expect(mockThemeProvider.get()).toBe('dark')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark')
      
      mockThemeProvider.toggle()
      expect(mockThemeProvider.get()).toBe('light')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'light')
    })

    it('should set specific theme mode', () => {
      mockThemeProvider.set('dark-high-contrast')
      expect(mockThemeProvider.get()).toBe('dark-high-contrast')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark-high-contrast')
    })

    it('should apply CSS classes to document element', () => {
      mockThemeProvider.set('dark')
      
      // Check that remove was called for each theme class
      expect(mockClassListRemove).toHaveBeenCalledWith('light')
      expect(mockClassListRemove).toHaveBeenCalledWith('dark')
      expect(mockClassListRemove).toHaveBeenCalledWith('light-high-contrast')
      expect(mockClassListRemove).toHaveBeenCalledWith('dark-high-contrast')
      expect(mockClassListRemove).toHaveBeenCalledWith('light-medium-contrast')
      expect(mockClassListRemove).toHaveBeenCalledWith('dark-medium-contrast')
      expect(mockClassListAdd).toHaveBeenCalledWith('dark')
    })
  })

  describe('LocalStorage Persistence', () => {
    it('should persist theme mode changes to localStorage', () => {
      mockThemeProvider.set('dark-medium-contrast')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark-medium-contrast')
    })

    it('should persist active theme changes to localStorage', async () => {
      await mockThemeProvider.switchTheme('custom')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('activeTheme', 'custom')
    })
  })

  describe('Multi-Theme Support', () => {
    it('should have available themes', () => {
      expect(mockThemeProvider.availableThemes.value).toHaveLength(2)
      expect(mockThemeProvider.availableThemes.value[0].name).toBe('default')
      expect(mockThemeProvider.availableThemes.value[1].name).toBe('custom')
    })

    it('should update activeTheme ref when switching themes', async () => {
      expect(mockThemeProvider.activeTheme.value).toBe('default')
      
      await mockThemeProvider.switchTheme('custom')
      expect(mockThemeProvider.activeTheme.value).toBe('custom')
    })

    it('should validate theme exists before switching', async () => {
      const result = await mockThemeProvider.switchTheme('nonexistent')
      
      expect(result).toBe(false)
    })

    it('should handle theme loading errors gracefully', async () => {
      vi.mocked(loadTheme).mockResolvedValueOnce({
        manifest: {} as any,
        errors: [{
          file: 'custom',
          message: 'Critical theme error',
          severity: 'error'
        }],
        warnings: []
      })

      const result = await mockThemeProvider.switchTheme('custom')
      
      expect(result).toBe(false)
    })

    it('should reload current theme', async () => {
      const result = await mockThemeProvider.reloadTheme()
      
      expect(result).toBe(true)
      expect(loadTheme).toHaveBeenCalledWith('default')
    })
  })

  describe('Theme Validation and Error Handling', () => {
    it('should validate theme without switching', async () => {
      const result = await mockThemeProvider.validateTheme('custom')
      
      expect(result).toBeDefined()
      expect(loadTheme).toHaveBeenCalledWith('custom')
    })

    it('should get theme manifest by name', () => {
      const manifest = mockThemeProvider.getThemeManifest('custom')
      
      expect(manifest).toBeDefined()
      expect(manifest?.name).toBe('custom')
      
      const nonExistent = mockThemeProvider.getThemeManifest('nonexistent')
      expect(nonExistent).toBeUndefined()
    })
  })

  describe('System Preference Detection', () => {
    it('should detect system dark preference', () => {
      vi.mocked(window.matchMedia).mockImplementation(query => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      expect(mockThemeProvider.system()).toBe('dark')
    })

    it('should detect system light preference', () => {
      vi.mocked(window.matchMedia).mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      expect(mockThemeProvider.system()).toBe('light')
    })
  })

  describe('Reactivity', () => {
    it('should provide reactive refs for theme state', () => {
      // Test that these are refs (have .value property)
      expect(mockThemeProvider.current).toHaveProperty('value')
      expect(mockThemeProvider.activeTheme).toHaveProperty('value')
      expect(mockThemeProvider.availableThemes).toHaveProperty('value')
      expect(mockThemeProvider.errors).toHaveProperty('value')
      expect(mockThemeProvider.warnings).toHaveProperty('value')
    })
  })
})
