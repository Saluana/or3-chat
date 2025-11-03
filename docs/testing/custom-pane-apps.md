# Testing & QA for Custom Pane Apps

This document outlines the comprehensive testing strategy for the custom pane apps feature, covering unit tests, integration tests, and end-to-end tests.

## Overview

The testing suite ensures that:
1. Page switching works correctly across different scenarios
2. Error fallback mechanisms function properly
3. Activation hooks are called in the correct order
4. Default sidebar interactions remain functional when custom pages are active
5. The sidebar works correctly in both collapsed and expanded modes
6. Responsive behavior is maintained across different viewports

## Test Structure

### Unit Tests (`app/composables/sidebar/__tests__/`)

#### 1. `useSidebarPageControls.extended.test.ts`
- **Purpose**: Tests core page switching functionality
- **Coverage**:
  - Successful page switching
  - Error handling during page switches
  - Helper functions (`useIsActivePage`, `useActivePageId`, etc.)
  - Reactive updates
  - Integration with `useSidebarPageState`

#### 2. `page-activation-hooks.test.ts`
- **Purpose**: Tests activation and deactivation hooks
- **Coverage**:
  - `onActivate` hook execution
  - `onDeactivate` hook execution
  - Hook execution order
  - `canActivate` guard functionality
  - Async hook handling
  - Error scenarios in hooks

#### 3. `sidebar-interactions.test.ts`
- **Purpose**: Tests sidebar functionality with custom pages
- **Coverage**:
  - Data availability (projects, threads, documents)
  - Query functionality
  - Section controls
  - Multi-pane API access
  - Footer actions
  - Data persistence across page switches

### E2E Tests (`tests/e2e/`)

#### 1. `sidebar-page-toggling.spec.ts`
- **Purpose**: Tests complete user workflows
- **Coverage**:
  - Page switching in expanded mode
  - Page switching in collapsed mode
  - State preservation during transitions
  - Rapid page switching
  - Sidebar interactions on plugin pages
  - Concurrent collapse/expand with page switching
  - Error handling
  - Responsive behavior
  - Keyboard navigation

## Running Tests

### Unit/Integration Tests
```bash
# Run all unit tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run tests with coverage
bun run test --coverage
```

### E2E Tests
```bash
# Install Playwright browsers (first time only)
bunx playwright install

# Run all E2E tests
bun run test:e2e

# Run E2E tests with UI
bun run test:e2e:ui

# Run E2E tests in debug mode
bun run test:e2e:debug

# Generate new tests with codegen
bun run test:e2e:codegen

# Run all tests (unit + E2E)
bun run test:all
```

## Test Fixtures and Utilities

### SidebarFixture (`tests/e2e/fixtures/sidebar-fixture.ts`)
Provides helper methods for common sidebar operations:
- Page switching
- Collapse/expand functionality
- Query manipulation
- Section toggling
- Project expansion
- State verification

### TestUtils (`tests/e2e/utils/test-utils.ts`)
Utility functions for:
- Animation waiting
- Responsive testing
- Accessibility checking
- Network condition simulation
- API mocking
- Screenshot capture

## Test Data and Mocking

### Mock Data Structure
```typescript
// Mock sidebar environment
const mockEnvironment = {
  projects: [{ id: 'proj1', title: 'Project 1' }],
  threads: [{ id: 'thread1', title: 'Thread 1' }],
  documents: [{ id: 'doc1', title: 'Document 1' }],
  // ... other mock data
};
```

### Page Definitions for Testing
```typescript
const testPages = [
  {
    id: 'todo-page',
    label: 'Todos',
    component: TodoComponent,
    onActivate: mockActivate,
    onDeactivate: mockDeactivate,
  },
  // ... other test pages
];
```

## Coverage Requirements

### Unit Tests
- **Line Coverage**: 90%
- **Statement Coverage**: 90%
- **Branch Coverage**: 90%
- **Function Coverage**: 75%

### E2E Tests
- All user workflows covered
- All viewport sizes tested
- All error scenarios simulated
- Accessibility compliance verified

## CI/CD Integration

### GitHub Actions Workflow
```yaml
name: Tests
on: [push, pull_request]
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run test:coverage
      
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bunx playwright install
      - run: bun run test:e2e
```

## Debugging Tests

### Unit Test Debugging
```bash
# Run specific test file
bun run vitest run useSidebarPageControls.extended.test.ts

# Run with debug output
bun run vitest --debug

# Run specific test
bun run vitest -t "should switch pages successfully"
```

### E2E Test Debugging
```bash
# Run with headed mode
bunx playwright test --headed

# Run with browser developer tools
bun run test:e2e:debug

# Generate playwright report
bunx playwright show-report
```

## Best Practices

### Unit Tests
1. **Mock external dependencies**: Use vi.mock() for external modules
2. **Test edge cases**: Include error scenarios and boundary conditions
3. **Use descriptive test names**: Clearly indicate what is being tested
4. **Arrange-Act-Assert pattern**: Structure tests clearly
5. **Avoid test pollution**: Clean up mocks and state between tests

### E2E Tests
1. **Use data-testid**: Avoid brittle selectors tied to CSS classes
2. **Wait for elements**: Use explicit waits instead of fixed timeouts
3. **Test real user flows**: Focus on complete user journeys
4. **Handle async operations**: Wait for network requests and animations
5. **Test multiple viewports**: Ensure responsive behavior

## Performance Considerations

### Test Performance
- **Parallel execution**: Run tests in parallel where possible
- **Selective test runs**: Use test patterns to run relevant tests
- **Mock expensive operations**: Avoid real network calls in unit tests
- **Reuse browser instances**: Configure Playwright for efficient test execution

### Production Performance
- **Bundle size monitoring**: Ensure test dependencies don't affect production
- **Runtime overhead**: Verify hooks and guards don't impact performance
- **Memory usage**: Monitor for memory leaks in page switching

## Troubleshooting

### Common Issues

#### 1. Tests Failing Due to Timing
**Problem**: Tests fail because elements aren't ready
**Solution**: Use proper wait strategies and test utilities

#### 2. Mock Configuration Issues
**Problem**: Mocks not working as expected
**Solution**: Ensure proper mock setup and cleanup

#### 3. E2E Test Flakiness
**Problem**: Tests pass locally but fail in CI
**Solution**: Use proper selectors and wait strategies

#### 4. Coverage Gaps
**Problem**: Coverage targets not met
**Solution**: Add tests for uncovered code paths

## Future Enhancements

### Planned Improvements
1. **Visual regression testing**: Compare screenshots across changes
2. **Performance testing**: Measure page switch performance
3. **Accessibility testing**: Automated a11y compliance checks
4. **Load testing**: Test behavior with large datasets
5. **Cross-browser testing**: Extended browser compatibility

### Test Metrics
1. **Test execution time**: Monitor and optimize test performance
2. **Flakiness rate**: Track and reduce test instability
3. **Coverage trends**: Maintain high code coverage
4. **Bug detection rate**: Measure effectiveness of test suite

## Conclusion

This comprehensive testing strategy ensures the reliability and robustness of the custom pane apps feature. The combination of unit tests, integration tests, and E2E tests provides coverage at all levels of the application, from individual composables to complete user workflows.

Regular execution of these tests helps catch regressions early and maintains the quality of the sidebar functionality as the feature evolves.
