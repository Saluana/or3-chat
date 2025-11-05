#!/usr/bin/env node
/**
 * Theme Switcher CLI Command
 * 
 * Usage: npm run theme:switch
 * 
 * Interactive theme picker that allows switching between available themes.
 */

import { ThemeCompiler } from '../theme-compiler';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import * as readline from 'readline';

interface ThemeInfo {
  name: string;
  displayName?: string;
  description?: string;
}

function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function discoverThemes(): Promise<ThemeInfo[]> {
  const compiler = new ThemeCompiler();
  
  try {
    const result = await compiler.compileAll();
    
    return result.themes
      .filter(t => t.errors.length === 0) // Only show valid themes
      .map(t => ({
        name: t.name,
        displayName: t.theme.displayName,
        description: t.theme.description,
      }));
  } catch (error) {
    console.error('❌ Failed to discover themes:', error);
    return [];
  }
}

async function getCurrentTheme(): Promise<string | null> {
  try {
    // Try to read from app config
    const configPath = join(process.cwd(), 'app.config.ts');
    const configContent = await readFile(configPath, 'utf-8');
    
    // Look for defaultTheme setting
    const match = configContent.match(/defaultTheme:\s*['"]([^'"]+)['"]/);
    if (match) {
      return match[1];
    }
    
    // Default to retro if not found
    return 'retro';
  } catch {
    return null;
  }
}

async function setDefaultTheme(themeName: string): Promise<void> {
  try {
    const configPath = join(process.cwd(), 'app.config.ts');
    let configContent = await readFile(configPath, 'utf-8');
    
    // Update or add defaultTheme setting
    if (configContent.includes('defaultTheme:')) {
      configContent = configContent.replace(
        /defaultTheme:\s*['"][^'"]*['"]/,
        `defaultTheme: '${themeName}'`
      );
    } else {
      // Add to theme config if it exists
      if (configContent.includes('theme:')) {
        configContent = configContent.replace(
          /theme:\s*{/,
          `theme: {\n    defaultTheme: '${themeName}',`
        );
      } else {
        // Add new theme config section before export
        configContent = configContent.replace(
          /export default defineAppConfig\({/,
          `export default defineAppConfig({\n  theme: {\n    defaultTheme: '${themeName}',\n  },`
        );
      }
    }
    
    await writeFile(configPath, configContent, 'utf-8');
  } catch (error) {
    console.error('❌ Failed to update config:', error);
    throw error;
  }
}

async function selectTheme(themes: ThemeInfo[], currentTheme: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = createReadlineInterface();
    
    console.log('\n🎨 Available Themes:\n');
    
    themes.forEach((theme, index) => {
      const isCurrent = theme.name === currentTheme;
      const prefix = isCurrent ? '▶' : ' ';
      const suffix = isCurrent ? ' (current)' : '';
      
      console.log(`${prefix} ${index + 1}. ${theme.displayName || theme.name}${suffix}`);
      if (theme.description) {
        console.log(`     ${theme.description}`);
      }
      console.log('');
    });
    
    rl.question('Select theme number (or press Enter to cancel): ', (answer) => {
      rl.close();
      
      const selection = parseInt(answer.trim(), 10);
      
      if (!answer.trim()) {
        resolve(null);
        return;
      }
      
      if (isNaN(selection) || selection < 1 || selection > themes.length) {
        console.log('\n❌ Invalid selection\n');
        resolve(null);
        return;
      }
      
      resolve(themes[selection - 1].name);
    });
  });
}

async function confirmSwitch(themeName: string, themeInfo: ThemeInfo): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createReadlineInterface();
    
    console.log(`\n📝 You selected: ${themeInfo.displayName || themeName}`);
    if (themeInfo.description) {
      console.log(`   ${themeInfo.description}`);
    }
    
    rl.question('\nSwitch to this theme? (y/N): ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

async function main() {
  console.log('\n🎨 Theme Switcher\n');
  console.log('Select a theme to set as default for the application.\n');
  
  try {
    // Discover available themes
    const themes = await discoverThemes();
    
    if (themes.length === 0) {
      console.error('❌ No valid themes found');
      process.exit(1);
    }
    
    // Get current theme
    const currentTheme = await getCurrentTheme();
    
    if (currentTheme) {
      console.log(`Current theme: ${currentTheme}\n`);
    }
    
    // Let user select theme
    const selectedTheme = await selectTheme(themes, currentTheme);
    
    if (!selectedTheme) {
      console.log('\n✋ Theme switch cancelled\n');
      process.exit(0);
    }
    
    // Skip if same as current
    if (selectedTheme === currentTheme) {
      console.log('\n✅ Already using this theme\n');
      process.exit(0);
    }
    
    // Confirm selection
    const themeInfo = themes.find(t => t.name === selectedTheme)!;
    const confirmed = await confirmSwitch(selectedTheme, themeInfo);
    
    if (!confirmed) {
      console.log('\n✋ Theme switch cancelled\n');
      process.exit(0);
    }
    
    // Update config
    await setDefaultTheme(selectedTheme);
    
    console.log(`\n✅ Theme switched to "${selectedTheme}"\n`);
    console.log('💡 Restart the dev server to see changes\n');
    
  } catch (error) {
    console.error('\n❌ Theme switch failed:');
    console.error(error);
    process.exit(1);
  }
}

main();
