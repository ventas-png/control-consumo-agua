import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'

import { RUTA_ESTADO } from './fixtures/vercelBypass'

// Raíz del repo, calculada desde ESTE archivo. El reporter json necesita una
// ruta ABSOLUTA: con 'playwright-results.json' a secas el archivo no quedó
// donde el verificador lo busca y el paso murió con ENOENT aunque la suite
// había corrido entera (run 32753812314). Una ruta anclada aquí no depende de
// desde qué directorio se invoque Playwright.
const RAIZ_DEL_REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
export const RUTA_REPORTE_JSON = join(RAIZ_DEL_REPO, 'playwright-results.json')

// E2E de los CAMINOS DE DINERO/AUTH (Track T8). Corren contra un despliegue
// ESTABLE de pruebas conectado al Supabase sandbox — NUNCA producción (el
// preflight del job rechaza los hosts de producción de vercel.json).
//
// En CI el job es FAIL-CLOSED: sin las variables obligatorias falla
// (scripts/e2e-preflight.mjs), y tras correr se exige que la suite haya
// ejecutado pruebas de verdad y sin skips inesperados (scripts/e2e-verificar.mjs
// sobre el reporte JSON de abajo). El auto-skip de e2e/fixtures/env.ts queda
// como comodidad LOCAL: en CI cualquier skip fuera de una omisión condicional
// declarada pone el job en rojo.
//
// VERCEL DEPLOYMENT PROTECTION — SIN headers globales. El token de bypass NO
// va en use.extraHTTPHeaders: Playwright enviaría ese header con TODAS las
// solicitudes del contexto, incluidas las de otros orígenes (Supabase, CDNs),
// filtrando el secreto. En su lugar, el proyecto `setup` (bypass.setup.ts)
// hace UNA petición al origen exacto del Preview y guarda la COOKIE de bypass
// en RUTA_ESTADO; el proyecto chromium la carga como storageState y el
// navegador la envía sólo a su propio origen. Ver e2e/fixtures/vercelBypass.ts.
//
// Local:  E2E_BASE_URL=http://localhost:5173 npx playwright test --config e2e/playwright.config.ts
// CI:     .github/workflows/e2e.yml (workflow dedicado; ver su header).
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
        ['json', { outputFile: RUTA_REPORTE_JSON }],
      ]
    : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      // Siembra la cookie de bypass ANTES de abrir ningún navegador. Sin
      // trace/video: la única petición de este proyecto lleva el token en un
      // header y no debe quedar grabada en ningún artifact.
      name: 'setup',
      testMatch: /bypass\.setup\.ts$/,
      use: { trace: 'off', video: 'off', screenshot: 'off' },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: RUTA_ESTADO },
      dependencies: ['setup'],
    },
  ],
})
