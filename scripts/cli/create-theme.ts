#!/usr/bin/env node
/**
 * Theme Creation CLI Command
 * 
 * Usage: npm run theme:create [theme-name]
 * 
 * Interactive scaffolding tool for creating new themes.
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import * as readline from 'readline';

interface ThemeOptions {
  name: string;
  displayName: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  surfaceColor: string;
}

function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function prompt(question: string, rl: readline.Interface): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function validateColorHex(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

function validateThemeName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

async function promptForThemeDetails(initialName?: string): Promise<ThemeOptions> {
  const rl = createReadlineInterface();
  
  try {
    console.log('\n🎨 Create New Theme\n');
    console.log('Please provide the following information:\n');
    
    // Theme name
    let name = initialName || '';
    while (!name || !validateThemeName(name)) {
      name = await prompt('Theme name (lowercase, kebab-case): ', rl);
      if (!validateThemeName(name)) {
        console.log('  ❌ Invalid name. Use lowercase letters, numbers, and hyphens only.');
      }
    }
    
    // Display name
    const displayName = await prompt(`Display name [${name}]: `, rl) || name;
    
    // Description
    const description = await prompt('Description: ', rl) || `${displayName} theme`;
    
    // Primary color
    let primaryColor = '';
    while (!primaryColor || !validateColorHex(primaryColor)) {
      primaryColor = await prompt('Primary color (hex, e.g., #3f8452): ', rl);
      if (!validateColorHex(primaryColor)) {
        console.log('  ❌ Invalid hex color. Use format: #RRGGBB');
      }
    }
    
    // Secondary color
    let secondaryColor = '';
    while (!secondaryColor || !validateColorHex(secondaryColor)) {
      secondaryColor = await prompt('Secondary color (hex, e.g., #5a7b62): ', rl);
      if (!validateColorHex(secondaryColor)) {
        console.log('  ❌ Invalid hex color. Use format: #RRGGBB');
      }
    }
    
    // Surface color
    let surfaceColor = '';
    while (!surfaceColor || !validateColorHex(surfaceColor)) {
      surfaceColor = await prompt('Surface/background color (hex, e.g., #f5faf5): ', rl);
      if (!validateColorHex(surfaceColor)) {
        console.log('  ❌ Invalid hex color. Use format: #RRGGBB');
      }
    }
    
    return {
      name,
      displayName,
      description,
      primaryColor,
      secondaryColor,
      surfaceColor,
    };
  } finally {
    rl.close();
  }
}

function generateThemeTemplate(options: ThemeOptions): string {
  return `/**
 * ${options.displayName} Theme
 * 
 * ${options.description}
 */

import { defineTheme } from '../_shared/define-theme';

export default defineTheme({
  name: '${options.name}',
  displayName: '${options.displayName}',
  description: '${options.description}',
  
  colors: {
    // Material Design 3 color tokens
    primary: '${options.primaryColor}',
    secondary: '${options.secondaryColor}',
    tertiary: '${options.primaryColor}', // Adjust if needed
    
    surface: '${options.surfaceColor}',
    surfaceVariant: '${options.surfaceColor}',
    
    // Semantic colors
    success: '#4a9763',
    warning: '#c8931d',
    error: '#b5473c',
    
    // Dark mode overrides (optional)
    dark: {
      primary: '${options.primaryColor}', // Adjust for dark mode
      surface: '#0c130d',
    },
  },
  
  // Component overrides (optional)
  overrides: {
    // Example: Global button styles
    // 'button': {
    //   variant: 'solid',
    //   size: 'md',
    // },
    
    // Example: Context-specific styles
    // 'button.chat': {
    //   variant: 'soft',
    //   size: 'sm',
    // },
    
    // Example: Identifier-specific styles
    // 'button#chat.send': {
    //   variant: 'solid',
    //   class: 'font-bold',
    // },
  },
});
`;
}

function generateReadme(options: ThemeOptions): string {
  return `# ${options.displayName} Theme

${options.description}

## Color Palette

- **Primary**: \`${options.primaryColor}\`
- **Secondary**: \`${options.secondaryColor}\`
- **Surface**: \`${options.surfaceColor}\`

## Usage

This theme is automatically discovered by the theme system. To activate it:

\`\`\`typescript
// In your component or app config
const { setActiveTheme } = useTheme();
setActiveTheme('${options.name}');
\`\`\`

## Customization

Edit \`theme.ts\` to customize:

1. **Colors**: Adjust the color palette
2. **Overrides**: Add component-specific styles using CSS selector syntax
3. **Dark Mode**: Configure dark mode color overrides

See the [Theme System Documentation](../../../docs/themes/) for more details.
`;
}

async function createTheme(options: ThemeOptions) {
  const themeDir = join(process.cwd(), 'app', 'theme', options.name);
  
  // Check if theme already exists
  if (existsSync(themeDir)) {
    console.error(`\n❌ Theme "${options.name}" already exists at ${themeDir}\n`);
    process.exit(1);
  }
  
  try {
    // Create theme directory
    await mkdir(themeDir, { recursive: true });
    
    // Generate files
    const themeFile = join(themeDir, 'theme.ts');
    const readmeFile = join(themeDir, 'README.md');
    
    await writeFile(themeFile, generateThemeTemplate(options), 'utf-8');
    await writeFile(readmeFile, generateReadme(options), 'utf-8');
    
    // Success message
    console.log('\n✅ Theme created successfully!\n');
    console.log(`📁 Location: ${themeDir}`);
    console.log('\n📝 Next steps:');
    console.log('  1. Review and customize theme.ts');
    console.log('  2. Add component overrides as needed');
    console.log('  3. Run npm run theme:validate to check for errors');
    console.log(`  4. Activate with setActiveTheme('${options.name}')`);
    console.log('');
    
  } catch (error) {
    console.error('\n❌ Failed to create theme:');
    console.error(error);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const initialName = args.find(arg => !arg.startsWith('--') && !arg.startsWith('-'));
  
  try {
    const options = await promptForThemeDetails(initialName);
    await createTheme(options);
  } catch (error) {
    console.error('\n❌ Theme creation cancelled or failed:');
    console.error(error);
    process.exit(1);
  }
}

main();
