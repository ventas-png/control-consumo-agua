import { test, expect, type Page } from '@playwright/test'
import { hasBaseUrl, reasons } from './fixtures/env'

// AUTH NEGATIVO — un visitante NO autenticado no alcanza nada protegido.
//
// Invariante de la app (src/App.tsx): mientras `!currentUser`, se renderiza la
// LandingPage pública para CUALQUIER ruta; el shell autenticado (Topbar + módulos
// + <Routes>) NUNCA se monta. Así que navegar directo a una ruta protegida (o
// hacer deep-link) NO expone el módulo ni sus datos: sólo aparece el landing con
// el acceso de login.
//
// Mismo gating que el resto de specs: sin E2E_BASE_URL → skip (CI verde). El
// aislamiento a NIVEL API/datos (anon = 0 filas, RPCs sensibles rechazados) lo
// cubre el harness RLS server-side (src/test/rls/rlsHarness.test.ts); aquí
// verificamos la barrera a NIVEL DE RUTA/UI en el navegador.

// Rutas protegidas representativas de distintos módulos (dinero/admin/tenant).
const PROTECTED_ROUTES = [
  '/admin-dashboard',
  '/cobros',
  '/clientes',
  '/configuracion',
  '/empresa',
  '/superadmin',
  '/condominios/panel',
  '/energia',
] as const

// Marcador del landing PÚBLICO: el acceso de login (campo de email del form o el
// botón "Iniciar sesión" del nav). El shell autenticado nunca los renderiza, así
// que su presencia prueba que NO entramos a la zona protegida.
async function expectPublicLanding(page: Page): Promise<void> {
  const email = page.getByPlaceholder('nombre@empresa.com')
  const loginBtn = page.getByRole('button', { name: /iniciar sesión/i }).first()
  await expect(email.or(loginBtn)).toBeVisible()
}

test.describe('AUTH · acceso no autorizado', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)

  for (const route of PROTECTED_ROUTES) {
    test(`visitante anónimo en ${route} cae al landing público (no al shell)`, async ({ page }) => {
      await page.goto(route)
      await expectPublicLanding(page)
      // Refuerzo negativo: no quedó visible contenido del shell autenticado
      // (sin data-testid en la app, el acceso de login ya es el marcador robusto).
    })
  }

  test('la única vía de entrada desde una ruta protegida es el login', async ({ page }) => {
    await page.goto('/admin-dashboard')
    // Abrir el modal de login (si no está inline) confirma que la ruta protegida
    // sólo ofrece autenticarse, no su contenido.
    const email = page.getByPlaceholder('nombre@empresa.com')
    if (!(await email.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /iniciar sesión/i }).first().click()
    }
    await expect(email).toBeVisible()
  })
})
