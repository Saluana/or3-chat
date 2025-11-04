// Theme switching script - run in browser console
// Open your browser at http://localhost:3001 and run this in console

async function setCyberpunkTheme() {
  try {
    // Switch to cyberpunk theme
    await window.$nuxt.$theme.switchTheme('cyberpunk')
    console.log('✅ Cyberpunk theme activated!')
    
    // You can also try these other themes:
    // await window.$nuxt.$theme.switchTheme('minimal')
    // await window.$nuxt.$theme.switchTheme('nature') 
    // await window.$nuxt.$theme.switchTheme('default')
    
    // Toggle light/dark mode
    // window.$nuxt.$theme.toggle()
    
    console.log('Available themes:', window.$nuxt.$theme.availableThemes.value)
    console.log('Current theme:', window.$nuxt.$theme.activeTheme.value)
    
  } catch (error) {
    console.error('❌ Error setting theme:', error)
  }
}

// Auto-execute the theme switch
setCyberpunkTheme()
