import { test, expect } from '@playwright/test'
import { login } from './fixtures/auth'
import { hasBaseUrl, hasLoginCreds, reasons } from './fixtures/env'
import { exists, gotoSection } from './fixtures/ui'

// CAMINO DE DINERO #2 (condominios) — emitir CUOTA → registrar PAGO.
// Requiere un proyecto de condominio sembrado con unidades y, para el pago, una
// cuota en estado pendiente/emitida. Guardas de runtime por dato faltante.
//
// LOS BOTONES SE DIRECCIONAN POR SU `title`. La barra de herramientas tiene un
// «Emitir período» (acción MASIVA con diálogo de confirmación) que aparece
// SIEMPRE, aunque la tabla no tenga ni una fila; el localizador por nombre de
// rol agarraba ése. La prueba pasaba sin haber emitido nada — verde falso
// (run 32778903667: la cuota E2E-PENDIENTE quedó en 'pendiente', emitida_at
// nulo). Los titles identifican la acción POR FILA.
//
// Y la aserción es el CONTEO de botones de fila, no «aparece el texto
// Emitida»: ese texto puede estar ya en la página (otra fila, un filtro) y
// volvería a pasar sin hacer nada. Que el botón desaparezca prueba la
// transición.
test.describe('CONDOMINIOS · cuota: emitir → pagar', () => {
  test.skip(!hasBaseUrl, reasons.baseUrl)
  test.skip(!hasLoginCreds, reasons.login)

  test('emite una cuota pendiente', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/condominios/cuotas')

    const emitibles = page.locator('button[title^="Emitir cuota"]')
    if (!(await exists(emitibles.first()))) {
      test.skip(true, 'sin cuotas pendientes en el proyecto activo — generar/sembrar una cuota')
    }

    const antes = await emitibles.count()
    await emitibles.first().click()
    await expect(emitibles).toHaveCount(antes - 1, { timeout: 20_000 })
  })

  test('registra el pago de una cuota', async ({ page }) => {
    await login(page)
    await gotoSection(page, '/condominios/cuotas')

    const cobrables = page.locator('button[title="Registrar pago de la cuota"]')
    if (!(await exists(cobrables.first()))) {
      test.skip(true, 'sin cuotas cobrables en el proyecto activo — sembrar una cuota emitida')
    }

    const antes = await cobrables.count()
    await cobrables.first().click()

    // Modal de pago: fecha (hoy por defecto) + método (efectivo por defecto).
    // Sólo confirmamos; los defaults bastan para el happy-path.
    await page.getByRole('button', { name: /Confirmar pago/i }).click()
    await expect(cobrables).toHaveCount(antes - 1, { timeout: 20_000 })
  })
})
