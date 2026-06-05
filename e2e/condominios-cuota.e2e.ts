import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import { hasBaseUrl, hasLoginCreds, reasons } from './fixtures/env'
import { exists, gotoSection } from './fixtures/ui'

// CAMINO DE DINERO #2 (condominios) — emitir CUOTA → registrar PAGO.
// Requiere un proyecto de condominio sembrado con unidades y, para el pago, una
// cuota en estado pendiente/emitida. Guardas de runtime por dato faltante.
test.describe('CONDOMINIOS · cuota: emitir → pagar', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasLoginCreds, reasons.login)

  test('emite una cuota pendiente', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/condominios/cuotas')

    const emitir = page.getByRole('button', { name: /Emitir/i }).first()
    if (!(await exists(emitir))) test.skip(true, 'sin cuotas pendientes — generar/sembrar una cuota')

    await emitir.click()
    await expect(page.getByText(/Emitida/i).first()).toBeVisible({ timeout: 20_000 })
  })

  test('registra el pago de una cuota', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/condominios/cuotas')

    const pagar = page.getByRole('button', { name: /Pagar/i }).first()
    if (!(await exists(pagar))) test.skip(true, 'sin cuotas cobrables — sembrar una cuota emitida')

    await pagar.click()

    // Modal de pago: fecha (hoy por defecto) + método (efectivo por defecto).
    // Sólo confirmamos; los defaults bastan para el happy-path.
    await page.getByRole('button', { name: /Confirmar pago/i }).click()
    await expect(page.getByText(/Pagada/i).first()).toBeVisible({ timeout: 20_000 })
  })
})
