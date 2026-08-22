import { defineConfig, devices } from '@playwright/test'

// E2E de los CAMINOS DE DINERO/AUTH (Track T8). Corren contra un despliegue
// ESTABLE de pruebas conectado al Supabase sandbox — NUNCA producción (el
// preflight del job rechaza los hosts de producción de vercel.json).
//
// En CI el job es FAIL-CLOSED: sin las variables obligatorias falla
// (scripts/e2e-preflight.mjs), y tras correr se exige que la suite haya
// ejecutado pruebas de verdad (scripts/e2e-verificar.mjs sobre el reporte
// JSON de abajo). El auto-skip de e2e/fixtures/env.ts queda como comodidad
// LOCAL: en CI un spec obligatorio enteramente skipped pone el job en rojo.
//
// Local:  E2E_BASE_URL=http://localhost:5173 npx playwright test --config e2e/playwright.config.ts
// CI:     job `e2e` de .github/workflows/coverage.yml.
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
    ? [
        ['github'],
        ['html', { open: 'never' }],
        ['list'],
        // El verificador post-ejecución (scripts/e2e-verificar.mjs) lee este
        // archivo para exigir que la suite corrió de verdad. Si se quita, ese
        // paso falla por reporte ausente — fail-closed, no silencio.
        ['json', { outputFile: 'playwright-results.json' }],
      ]
    : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
