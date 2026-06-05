import { test, expect } from '@playwright/test'
import { login, openLoginModal } from './fixtures/auth'
import { hasBaseUrl, hasLoginCreds, LOGIN, reasons } from './fixtures/env'

// CAMINO DE AUTH #1 — Login email/password (Supabase) desde el modal del landing.
test.describe('AUTH · login', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)

  test('credenciales inválidas NO autentican', async ({ page }) => {
    await openLoginModal(page)
    await page.getByPlaceholder('nombre@empresa.com').fill('no-existe@example.com')
    await page.getByPlaceholder('••••••••').fill('contraseña-incorrecta')
    await page.getByRole('button', { name: /iniciar sesión/i }).click()

    // El modal sigue presente (no entró al shell). Es la afirmación robusta:
    // no dependemos del texto exacto del error de Supabase.
    await expect(page.getByPlaceholder('nombre@empresa.com')).toBeVisible()
  })

  test('login válido entra al shell autenticado', async ({ page }) => {
    test.skip(!hasLoginCreds, reasons.login)
    await login(page, LOGIN.email, LOGIN.password)
    // login() ya afirma que el campo de credenciales desaparece. Reforzamos que
    // NO seguimos en el landing público (sin formulario de login visible).
    await expect(page.getByPlaceholder('nombre@empresa.com')).toBeHidden()
  })
})
