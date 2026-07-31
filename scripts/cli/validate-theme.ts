#!/usr/bin/env node
/**
 * Theme Validation CLI Command
 * 
 * Usage: npm run theme:validate [theme-name]
 * 
 * Validates theme configuration, checks for errors, and reports issues.
 */

import { ThemeCompiler } from '../theme-compiler';

interface ValidationOptions {
  themeName?: string;
  verbose?: boolean;
}

async function validateTheme(options: ValidationOptions = {}) {
  const compiler = new ThemeCompiler();
  
  console.log('\n🔍 Validating themes...\n');
  
  try {
    // Compile all themes or specific theme
    const result = await compiler.compileAll();
    
    let totalErrors = 0;
    let totalWarnings = 0;
    let successCount = 0;
    
    // Filter by theme name if specified
    const themesToCheck = options.themeName
      ? result.themes.filter(t => t.name === options.themeName)
      : result.themes;
    
    if (themesToCheck.length === 0) {
      console.error(`❌ Theme "${options.themeName}" not found`);
      process.exit(1);
    }
    
    // Report results for each theme
    for (const themeResult of themesToCheck) {
      const hasErrors = themeResult.errors.length > 0;
      const hasWarnings = themeResult.warnings.length > 0;
      if (!hasErrors) successCount++;
      totalErrors += themeResult.errors.length;
      totalWarnings += themeResult.warnings.length;
      
      if (hasErrors) {
        console.log(`❌ ${themeResult.name}`);
      } else if (hasWarnings) {
        console.log(`⚠️  ${themeResult.name}`);
      } else {
        console.log(`✅ ${themeResult.name}`);
      }
      
      // Show errors
      if (themeResult.errors.length > 0) {
        console.log('\n  Errors:');
        for (const error of themeResult.errors) {
          console.log(`    [${error.code}] ${error.message}`);
          if (error.file) {
            console.log(`    File: ${error.file}${error.line ? `:${error.line}` : ''}`);
          }
          if (error.suggestion && options.verbose) {
            console.log(`    💡 ${error.suggestion}`);
          }
        }
        console.log('');
      }
      
      // Show warnings
      if (themeResult.warnings.length > 0 && options.verbose) {
        console.log('\n  Warnings:');
        for (const warning of themeResult.warnings) {
          console.log(`    [${warning.code}] ${warning.message}`);
          if (warning.file) {
            console.log(`    File: ${warning.file}`);
          }
        }
        console.log('');
      }
    }
    
    // Summary
    console.log('\n📊 Summary:');
    console.log(`  ✅ Success: ${successCount}/${themesToCheck.length}`);
    if (totalErrors > 0) {
      console.log(`  ❌ Errors: ${totalErrors}`);
    }
    if (totalWarnings > 0) {
      console.log(`  ⚠️  Warnings: ${totalWarnings}`);
    }
    console.log('');
    
    // Exit with error code if validation failed
    if (totalErrors > 0) {
      console.error('❌ Theme validation failed\n');
      process.exit(1);
    }
    
    console.log('✅ All themes validated successfully\n');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Theme validation failed:');
    console.error(error);
    process.exit(1);
  }
}

// Parse CLI arguments
const args = process.argv.slice(2);
const options: ValidationOptions = {
  verbose: args.includes('--verbose') || args.includes('-v'),
  themeName: args.find(arg => !arg.startsWith('--') && !arg.startsWith('-')),
};

// Run validation
validateTheme(options);
