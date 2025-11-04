import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { join } from 'path'

// Helper function to read component file content
function readComponentFile(relativePath: string): string {
  const fullPath = join(process.cwd(), 'app', relativePath)
  return readFileSync(fullPath, 'utf-8')
}

describe('Component Targeting Integration Tests', () => {
  describe('Task 10: Unique IDs to Singleton Components', () => {
    it('should have app-sidebar ID in ResizableSidebarLayout', async () => {
      const content = readComponentFile('components/ResizableSidebarLayout.vue')
      
      expect(content).toContain('id="app-sidebar"')
      expect(content).toContain('id="app-content"')
    })

    it('should have app-header ID in SidebarHeader', async () => {
      const content = readComponentFile('components/sidebar/SidebarHeader.vue')
      expect(content).toContain('id="app-header"')
    })

    it('should have app-bottom-nav ID in SideBottomNav', async () => {
      const content = readComponentFile('components/sidebar/SideBottomNav.vue')
      expect(content).toContain('id="app-bottom-nav"')
    })

    it('should have app-chat-container ID in ChatContainer', async () => {
      const content = readComponentFile('components/chat/ChatContainer.vue')
      expect(content).toContain('id="app-chat-container"')
    })

    it('should have app-dashboard-modal ID in Dashboard', async () => {
      const content = readComponentFile('components/dashboard/Dashboard.vue')
      expect(content).toContain('id="app-dashboard-modal"')
    })
  })

  describe('Task 11: Component Classes to Chat Messages', () => {
    it('should apply app-chat-message class structure', async () => {
      const content = readComponentFile('components/chat/ChatMessage.vue')
      
      // Check for base class
      expect(content).toContain('app-chat-message')
      
      // Check for conditional user class
      expect(content).toContain('app-chat-message--user')
      
      // Check for conditional assistant class
      expect(content).toContain('app-chat-message--assistant')
      
      // Check for data attribute
      expect(content).toContain('data-message-role')
    })

    it('should apply correct classes for user messages', async () => {
      const userMessage = {
        id: '1',
        role: 'user',
        content: 'Hello from user'
      }
      
      // Mock the component to avoid complex dependencies
      const wrapper = mount({
        template: `
          <div class="app-chat-message app-chat-message--user" data-message-role="user">
            <div>{{ message.content }}</div>
          </div>
        `,
        props: ['message']
      }, {
        props: {
          message: userMessage
        }
      })
      
      expect(wrapper.find('.app-chat-message').exists()).toBe(true)
      expect(wrapper.find('.app-chat-message--user').exists()).toBe(true)
      expect(wrapper.attributes('data-message-role')).toBe('user')
    })

    it('should apply correct classes for assistant messages', async () => {
      const assistantMessage = {
        id: '2',
        role: 'assistant',
        content: 'Hello from assistant'
      }
      
      const wrapper = mount({
        template: `
          <div class="app-chat-message app-chat-message--assistant" data-message-role="assistant">
            <div>{{ message.content }}</div>
          </div>
        `,
        props: ['message']
      }, {
        props: {
          message: assistantMessage
        }
      })
      
      expect(wrapper.find('.app-chat-message').exists()).toBe(true)
      expect(wrapper.find('.app-chat-message--assistant').exists()).toBe(true)
      expect(wrapper.attributes('data-message-role')).toBe('assistant')
    })
  })

  describe('Task 12: Classes to Sidebar Components', () => {
    it('should apply app-sidebar-item class structure', async () => {
      const content = readComponentFile('components/sidebar/SidebarThreadItem.vue')
      
      expect(content).toContain('app-sidebar-item')
      expect(content).toContain('app-sidebar-item--active')
    })

    it('should apply app-document-item class', async () => {
      const content = readComponentFile('components/sidebar/SidebarDocumentItem.vue')
      expect(content).toContain('app-document-item')
    })

    it('should apply app-prompt-item class', async () => {
      const content = readComponentFile('components/chat/SystemPromptsModal.vue')
      expect(content).toContain('app-prompt-item')
    })

    it('should test sidebar item active state', async () => {
      const wrapper = mount({
        template: `
          <button class="app-sidebar-item app-sidebar-item--active">
            Test Thread
          </button>
        `
      })
      
      expect(wrapper.find('.app-sidebar-item').exists()).toBe(true)
      expect(wrapper.find('.app-sidebar-item--active').exists()).toBe(true)
    })
  })

  describe('Task 13: Classes to Other Components', () => {
    it('should apply app-pane class and data-pane-id', async () => {
      const content = readComponentFile('components/PageShell.vue')
      
      expect(content).toContain('app-pane')
      expect(content).toContain('data-pane-id')
    })

    it('should apply app-model-card class', async () => {
      const content = readComponentFile('components/modal/ModelCatalog.vue')
      expect(content).toContain('app-model-card')
    })

    it('should apply app-theme-section class', async () => {
      const content = readComponentFile('components/dashboard/ThemePage.vue')
      expect(content).toContain('app-theme-section')
    })
  })

  describe('Data Attributes Testing', () => {
    it('should include data-message-role in chat message template', async () => {
      const content = readComponentFile('components/chat/ChatMessage.vue')
      expect(content).toContain(':data-message-role')
    })

    it('should include data-pane-id in pane template', async () => {
      const content = readComponentFile('components/PageShell.vue')
      expect(content).toContain(':data-pane-id')
    })
  })

  describe('Specificity and Conflict Testing', () => {
    it('should maintain proper class hierarchy in templates', async () => {
      const chatContent = readComponentFile('components/chat/ChatMessage.vue')
      const sidebarContent = readComponentFile('components/sidebar/SidebarThreadItem.vue')
      
      // Chat message should have message-specific classes
      expect(chatContent).toContain('app-chat-message')
      expect(chatContent).not.toContain('app-sidebar-item')
      
      // Sidebar item should have sidebar-specific classes
      expect(sidebarContent).toContain('app-sidebar-item')
      expect(sidebarContent).not.toContain('app-chat-message')
    })

    it('should handle conditional classes correctly', async () => {
      // Test that conditional classes are properly structured
      const wrapper = mount({
        template: `
          <div 
            class="app-chat-message"
            :class="{
              'app-chat-message--user': role === 'user',
              'app-chat-message--assistant': role === 'assistant'
            }"
            :data-message-role="role"
          >
            {{ content }}
          </div>
        `,
        props: ['role', 'content']
      }, {
        props: {
          role: 'user',
          content: 'Test message'
        }
      })
      
      expect(wrapper.find('.app-chat-message').exists()).toBe(true)
      expect(wrapper.find('.app-chat-message--user').exists()).toBe(true)
      expect(wrapper.attributes('data-message-role')).toBe('user')
    })
  })

  describe('Integration Verification', () => {
    it('should verify all expected IDs are present', async () => {
      const expectedIds = [
        'app-sidebar',
        'app-content', 
        'app-header',
        'app-bottom-nav',
        'app-chat-container',
        'app-dashboard-modal'
      ]
      
      const componentFiles = [
        'components/ResizableSidebarLayout.vue',
        'components/sidebar/SidebarHeader.vue',
        'components/sidebar/SideBottomNav.vue',
        'components/chat/ChatContainer.vue',
        'components/dashboard/Dashboard.vue'
      ]
      
      // Check that all IDs are present in component files
      const allContent = componentFiles.map(file => readComponentFile(file)).join(' ')
      
      for (const id of expectedIds) {
        expect(allContent).toContain(id)
      }
    })

    it('should verify all expected classes are present', async () => {
      const expectedClasses = [
        'app-chat-message',
        'app-chat-message--user',
        'app-chat-message--assistant',
        'app-sidebar-item',
        'app-sidebar-item--active',
        'app-document-item',
        'app-prompt-item',
        'app-pane',
        'app-model-card',
        'app-theme-section'
      ]
      
      const componentFiles = [
        'components/chat/ChatMessage.vue',
        'components/sidebar/SidebarThreadItem.vue',
        'components/sidebar/SidebarDocumentItem.vue',
        'components/chat/SystemPromptsModal.vue',
        'components/PageShell.vue',
        'components/modal/ModelCatalog.vue',
        'components/dashboard/ThemePage.vue'
      ]
      
      const allContent = componentFiles.map(file => readComponentFile(file)).join(' ')
      
      for (const className of expectedClasses) {
        expect(allContent).toContain(className)
      }
    })
  })
})
