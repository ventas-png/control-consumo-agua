import { defineConfig, devices } from '@playwright/test'

// E2E de los CAMINOS DE DINERO/AUTH (Track T8). Corren contra el PREVIEW del PR
// o un SANDBOX — NUNCA producción. baseURL viene de E2E_BASE_URL; sin esa env los
// specs se auto-skipean (ver e2e/fixtures/env.ts) para no romper CI sin secretos.
//
// Local:  E2E_BASE_URL=http://localhost:5173 npx playwright test --config e2e/playwright.config.ts
// CI:     job `e2e` de .github/workflows/coverage.yml (gated por secretos del repo).
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173'

export default defineConfig({
  testDir: '.',
  // *.e2e.ts (no *.spec.ts) para NO chocar con el glob por defecto de Vitest
  // (**/*.{test,spec}.ts), que de otro modo intentaría correrlos sin Playwright.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
