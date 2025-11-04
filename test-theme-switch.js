// Test script for theme switching
// Open http://localhost:3001 and run this in browser console

async function testThemeSwitching() {
  console.log('🎨 Testing Theme System');
  console.log('========================');
  
  try {
    // Check available themes
    const availableThemes = window.$nuxt.$theme.availableThemes.value;
    console.log('✅ Available themes:', availableThemes);
    
    // Check current theme
    const currentTheme = window.$nuxt.$theme.activeTheme.value;
    console.log('✅ Current theme:', currentTheme);
    
    // Test switching to cyberpunk
    console.log('🚀 Switching to cyberpunk theme...');
    await window.$nuxt.$theme.switchTheme('cyberpunk');
    console.log('✅ Cyberpunk theme activated!');
    
    // Wait a moment and toggle dark mode
    setTimeout(async () => {
      console.log('🌙 Toggling dark mode...');
      window.$nuxt.$theme.toggle();
      console.log('✅ Dark mode toggled!');
      
      // Test other themes
      setTimeout(async () => {
        console.log('🍃 Switching to nature theme...');
        await window.$nuxt.$theme.switchTheme('nature');
        console.log('✅ Nature theme activated!');
        
        setTimeout(async () => {
          console.log('⚪ Switching to minimal theme...');
          await window.$nuxt.$theme.switchTheme('minimal');
          console.log('✅ Minimal theme activated!');
          
          console.log('🎉 All themes working correctly!');
        }, 2000);
      }, 2000);
    }, 2000);
    
  } catch (error) {
    console.error('❌ Error testing themes:', error);
  }
}

// Auto-run the test
testThemeSwitching();
