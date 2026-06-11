import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import { gotoSection } from './fixtures/ui'
import { hasBaseUrl, hasRestrictedCreds, RESTRICTED, reasons } from './fixtures/env'

// AUTH NEGATIVO AUTENTICADO (P2 #8) — un usuario con rol RESTRINGIDO
// (viewer/operator) NO alcanza las secciones de administración aunque esté
// dentro del shell autenticado y navegue por URL directa (deep-link).
//
// Complementa unauthorized-access.e2e.ts (visitante anónimo → landing) y el
// harness RLS server-side (anon/tenant a nivel de datos): aquí verificamos la
// barrera de ROL a nivel de ruta/UI — el registro declarativo de rutas
// (src/components/app/routes.tsx) debe responder con la pantalla
// "Acceso Denegado" de RoleGuard/AccessDenied, nunca con la sección.
//
// Gating: requiere E2E_RESTRICTED_EMAIL/PASSWORD (usuario sembrado con rol
// viewer u operator del mismo tenant). Sin ellas → skip (CI verde).

// Rutas vetadas para CUALQUIER rol no-admin/no-owner (guards declarados en
// APP_ROUTES): superadmin (solo super_admin), empresa y admin-dashboard
// (company_owner), configuración y contabilidad (admin+).
const ADMIN_ONLY_ROUTES = [
  '/superadmin',
  '/empresa',
  '/admin-dashboard',
  '/configuracion',
  '/contabilidad',
] as const

test.describe('AUTH · rol restringido no alcanza secciones de administración', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasRestrictedCreds, reasons.restricted)

  for (const route of ADMIN_ONLY_ROUTES) {
    test(`usuario restringido en ${route} ve "Acceso Denegado" (no la sección)`, async ({ page }) => {
      await login(page, RESTRICTED.email, RESTRICTED.password)
      await gotoSection(page, route)
      // Marcador de RoleGuard/AccessDenied (src/components/shared/AccessDenied.tsx).
      await expect(page.getByText(/Acceso Denegado/i).first()).toBeVisible({ timeout: 15_000 })
      // Refuerzo negativo: no quedó visible un encabezado típico de la sección
      // administrativa (botones de guardado/altas de configuración).
      await expect(page.getByText(/Contacta a tu administrador/i).first()).toBeVisible()
    })
  }
})
